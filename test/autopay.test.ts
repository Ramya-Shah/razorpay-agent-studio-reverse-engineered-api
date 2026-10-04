import { describe, expect, it } from "vitest";
import { buildRetryAdvice, percentile } from "../src/advice.js";
import { addMonths } from "../src/client.js";
import { NotFoundError, StructureChangedError, ValidationError } from "../src/errors.js";
import { buildServer } from "../src/server.js";
import { UpiStatsService } from "../src/service.js";
import type { AutopayStats } from "../src/types.js";
import { fixture, fixtureNet, makeClient } from "./helpers.js";

const svc = (net = fixtureNet()) => new UpiStatsService(makeClient({}, net).client);
const noData = fixture("top50-remitter-2026-09-nodata");

describe("AutoPay tables", () => {
  it("execution stats are typed numbers", async () => {
    expect(await svc().getAutopayBankStats("State Bank of India", "2026-08")).toMatchObject({
      kind: "execution",
      rank: 1,
      volume: 571.273804,
      approvedPct: 28.66,
      bdPct: 70.81,
      tdPct: 0.53,
    });
  });

  it("registration is a separate table with its own numbers", async () => {
    const s = await svc().getAutopayBankStats("State Bank of India", "2026-08", "registration");
    expect(s).toMatchObject({ kind: "registration", approvedPct: 95.32, tdPct: 0.02 });
  });

  it("worst_autopay_banks_by_td is sorted, highest first", async () => {
    const r = await svc().worstAutopayBanksByTd("2026-08", 3);
    expect(r.map((b) => b.bank)[0]).toBe("Maharashtra Gramin Bank");
    expect(r[0]!.tdPct).toBeGreaterThanOrEqual(r[1]!.tdPct);
  });

  it("a renamed column -> StructureChangedError", async () => {
    const bad = fixture("autopay-execution-2026-08").replace(/td_percent/g, "tech_decline");
    const s = svc(fixtureNet(() => ({ status: 200, text: bad })));
    await expect(s.getAutopayBankStats("State Bank of India", "2026-08")).rejects.toBeInstanceOf(StructureChangedError);
  });

  it("unpublished month -> NotFoundError; bad kind -> ValidationError", async () => {
    const s = svc(fixtureNet(() => ({ status: 200, text: noData })));
    await expect(s.getAutopayBankStats("State Bank of India", "2026-09")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().getAutopayBankStats("sbi", "2026-08", "payments")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("recommend_retry (against the real August 2026 AutoPay table)", () => {
  it("technical failure at a low-TD bank: retry soon, short window", async () => {
    const a = await svc().recommendRetry("State Bank of India", "2026-08", "technical");
    expect(a).toMatchObject({ action: "retry_soon", retryAfterHours: { min: 1, max: 3 }, maxAttempts: 3, nudgeCustomer: false });
    expect(a.bankProfile!.tdBand).toBe("low");
  });

  it("technical failure at a worst-decile bank: retry later, fewer attempts, nudge customer", async () => {
    const a = await svc().recommendRetry("Karnataka Grameena Bank", "2026-08", "technical");
    expect(a).toMatchObject({ action: "retry_later", retryAfterHours: { min: 12, max: 24 }, maxAttempts: 2, nudgeCustomer: true });
    expect(a.bankProfile!.tdBand).toBe("high");
  });

  it("business failure: hold and notify the customer, never a quick retry", async () => {
    const a = await svc().recommendRetry("State Bank of India", "2026-08", "business");
    expect(a).toMatchObject({ action: "hold_and_notify_customer", retryAfterHours: { min: 24, max: 72 }, maxAttempts: 2 });
  });

  it("unknown failure type: conservative default plus a prompt to classify first", async () => {
    const a = await svc().recommendRetry("State Bank of India", "2026-08", "unknown");
    expect(a.action).toBe("retry_later");
    expect(a.caveats.join(" ")).toContain("Classify the gateway error code");
  });

  it("always states what the data cannot do", async () => {
    const a = await svc().recommendRetry("HDFC Bank", "2026-08", "technical");
    expect(a.caveats.join(" ")).toContain("cannot tell whether the bank is having a problem right now");
  });

  it("bank outside the top 50 -> insufficient_data, with no invented numbers", async () => {
    const a = await svc().recommendRetry("Bank of Atlantis", "2026-08", "technical");
    expect(a.action).toBe("insufficient_data");
    expect(a.retryAfterHours).toBeUndefined();
    expect(a.bankProfile).toBeUndefined();
  });

  it("lookback tolerates months NPCI has not published", async () => {
    const net = fixtureNet((url) => (url.includes("month=Jul") || url.includes("month=Jun") ? { status: 200, text: noData } : undefined));
    const a = await svc(net).recommendRetry("State Bank of India", "2026-08", "technical", 3);
    expect(a.bankProfile!.monthsChecked).toBe(1);
    expect(a.bankProfile!.chronicallyElevatedTd).toBeNull();
  });

  it.each([
    ["bad failure type", () => svc().recommendRetry("sbi", "2026-08", "weird")],
    ["lookback 0", () => svc().recommendRetry("sbi", "2026-08", "technical", 0)],
    ["lookback 7", () => svc().recommendRetry("sbi", "2026-08", "technical", 7)],
    ["ambiguous bank", () => svc().recommendRetry("bank", "2026-08", "technical")],
  ])("rejects %s", async (_n, run) => {
    await expect(run()).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("advice rules on synthetic tables (pure function)", () => {
  const mk = (month: string, tdByBank: Record<string, number>): AutopayStats[] =>
    Object.entries(tdByBank).map(([bank, tdPct], i) => ({
      bank, month, kind: "execution", rank: i + 1, volume: 100 - i, approvedPct: 20, bdPct: 78, tdPct,
    }));
  const names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const table = (month: string, target: number) =>
    mk(month, Object.fromEntries(names.map((n, i) => [n, n === "A" ? target : (i + 1) * 0.1])));

  it("chronic: elevated in most months upgrades a low-band bank and nudges the customer", () => {
    const a = buildRetryAdvice({
      bank: "A", month: "2026-08", failureType: "technical",
      table: table("2026-08", 0.05),
      earlierTables: [table("2026-07", 9), table("2026-06", 9)],
    });
    expect(a.bankProfile!.tdBand).toBe("low");
    expect(a.bankProfile!.chronicallyElevatedTd).toBe(true);
    expect(a).toMatchObject({ action: "retry_later", nudgeCustomer: true });
  });

  it("not chronic when the bank is only elevated in one of three months", () => {
    const a = buildRetryAdvice({
      bank: "A", month: "2026-08", failureType: "technical",
      table: table("2026-08", 0.05),
      earlierTables: [table("2026-07", 9), table("2026-06", 0.05)],
    });
    expect(a.bankProfile!.chronicallyElevatedTd).toBe(false);
    expect(a.action).toBe("retry_soon");
  });

  it("flags small-sample banks", () => {
    const t = table("2026-08", 0.05);
    t[0]!.volume = 0.1;
    expect(buildRetryAdvice({ bank: "A", month: "2026-08", failureType: "technical", table: t }).bankProfile!.lowVolume).toBe(true);
  });
});

describe("helpers", () => {
  it("addMonths crosses year boundaries", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-08", -2)).toBe("2026-06");
  });
  it("percentile picks from the sorted values", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
  });
});

describe("HTTP routes", () => {
  const app = () => buildServer(svc());
  it("GET /retry-advice", async () => {
    const res = await app().inject({ url: "/retry-advice?bank=State Bank of India&month=2026-08&failure_type=technical" });
    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe("retry_soon");
  });
  it("400 on a bad failure_type, 400 on a missing one", async () => {
    expect((await app().inject({ url: "/retry-advice?bank=sbi&month=2026-08&failure_type=x" })).statusCode).toBe(400);
    expect((await app().inject({ url: "/retry-advice?bank=sbi&month=2026-08" })).statusCode).toBe(400);
  });
  it("GET /autopay/bank-stats and /autopay/worst-by-td", async () => {
    const a = app();
    expect((await a.inject({ url: "/autopay/bank-stats?bank=State Bank of India&month=2026-08" })).json().approvedPct).toBe(28.66);
    expect((await a.inject({ url: "/autopay/worst-by-td?month=2026-08&n=2" })).json()).toHaveLength(2);
  });
});

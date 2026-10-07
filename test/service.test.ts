import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../src/errors.js";
import { UpiStatsService } from "../src/service.js";
import { makeClient } from "./helpers.js";

const svc = () => new UpiStatsService(makeClient().client);

describe("normal results", () => {
  it("get_bank_stats returns typed numbers for a remitter bank", async () => {
    const s = await svc().getBankStats("State Bank of India", "2026-08");
    expect(s).toMatchObject({
      bank: "State Bank of India",
      side: "remitter",
      rank: 1,
      volumeMn: 6845.842221,
      approvedPct: 90.78,
      bdPct: 9.11,
      tdPct: 0.1,
      debitReversalSuccessPct: 96.6,
    });
  });

  it("matches bank names case-insensitively and by unique fragment", async () => {
    const s = await svc().getBankStats("hdfc", "2026-08");
    expect(s.bank).toBe("HDFC Bank Ltd.");
  });

  it("beneficiary rows carry deemed-approved and no debit-reversal fields", async () => {
    const s = await svc().getBankStats("State Bank of India", "2026-08", "beneficiary");
    expect(s.side).toBe("beneficiary");
    expect(s.deemedApprovedPct).toBeTypeOf("number");
    expect(s.debitReversalSuccessPct).toBeUndefined();
  });

  it("list_banks returns all 50 banks", async () => {
    const r = await svc().listBanks("2026-08");
    expect(r.banks).toHaveLength(50);
    expect(r.banks).toContain("Bank of Baroda");
  });

  it("compare_banks keeps the requested order", async () => {
    const r = await svc().compareBanks(["HDFC Bank", "State Bank of India"], "2026-08");
    expect(r.map((b) => b.bank)).toEqual(["HDFC Bank Ltd.", "State Bank of India"]);
  });

  it("worst_banks_by_td is sorted by technical declines, highest first", async () => {
    const r = await svc().worstBanksByTd("2026-08", 5);
    expect(r).toHaveLength(5);
    for (let i = 1; i < r.length; i++) expect(r[i - 1]!.tdPct).toBeGreaterThanOrEqual(r[i]!.tdPct);
  });

  it("monthly_trend returns null for months NPCI has not published", async () => {
    const r = await svc().monthlyTrend("State Bank of India", "tdPct", ["2026-08", "2026-09"]);
    expect(r.points).toEqual([
      { month: "2026-08", value: 0.1 },
      { month: "2026-09", value: null },
    ]);
  });

  it("uptime can be below 100% with no unscheduled downtime (scheduled downtime counts)", async () => {
    expect(await svc().getUptime("2026-09")).toEqual({
      month: "2026-09",
      uptimePct: 99.9907,
      unscheduledDowntimeMins: 0,
      incidents: 0,
    });
  });

  it("get_uptime reads NIL downtime as zero", async () => {
    expect(await svc().getUptime("2026-07")).toEqual({
      month: "2026-07",
      uptimePct: 100,
      unscheduledDowntimeMins: 0,
      incidents: 0,
    });
  });
});

describe("unknown bank or month", () => {
  it("unknown bank -> NotFoundError", async () => {
    await expect(svc().getBankStats("Bank of Atlantis", "2026-08")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("month NPCI has not published -> NotFoundError", async () => {
    await expect(svc().getBankStats("State Bank of India", "2026-09")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().getUptime("2026-08")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("trend with no data in any month -> NotFoundError", async () => {
    await expect(svc().monthlyTrend("Bank of Atlantis", "tdPct", ["2026-08", "2026-09"])).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("bad input is rejected before any network call", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["month in wrong format", () => svc().getBankStats("sbi", "Aug 2026")],
    ["month 13", () => svc().getBankStats("sbi", "2026-13")],
    ["empty bank", () => svc().getBankStats("  ", "2026-08")],
    ["ambiguous bank", () => svc().getBankStats("bank", "2026-08")],
    ["bad side", () => svc().getBankStats("sbi", "2026-08", "payer")],
    ["compare with one bank", () => svc().compareBanks(["sbi"], "2026-08")],
    ["n = 0", () => svc().worstBanksByTd("2026-08", 0)],
    ["n = 51", () => svc().worstBanksByTd("2026-08", 51)],
    ["unknown metric", () => svc().monthlyTrend("sbi", "vibes", ["2026-07", "2026-08"])],
    ["single-month trend", () => svc().monthlyTrend("sbi", "tdPct", ["2026-08"])],
  ];
  it.each(cases)("%s", async (_name, run) => {
    await expect(run()).rejects.toBeInstanceOf(ValidationError);
  });

  it("makes zero network calls for invalid month", async () => {
    const t = makeClient();
    await expect(new UpiStatsService(t.client).getUptime("nope")).rejects.toBeInstanceOf(ValidationError);
    expect(t.net.calls).toHaveLength(0);
  });
});

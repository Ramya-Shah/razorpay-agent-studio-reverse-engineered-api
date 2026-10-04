import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NpciClient } from "../src/client.js";
import { RateLimitedError, StructureChangedError, UpstreamError, ValidationError } from "../src/errors.js";
import { fixture, fixtureNet, makeClient } from "./helpers.js";

describe("rate limits and server errors (mocked)", () => {
  it("429 with Retry-After: waits the hinted time, then succeeds", async () => {
    const net = fixtureNet((_u, call) => (call === 1 ? { status: 429, retryAfter: "7", text: "slow down" } : undefined));
    const t = makeClient({}, net);
    const table = await t.client.getBankTable("remitter", "2026-08");
    expect(table).toHaveLength(50);
    expect(t.net.calls).toHaveLength(2);
    expect(t.sleeps).toContain(7000);
  });

  it("persistent 429 -> RateLimitedError carrying the retry hint", async () => {
    const net = fixtureNet(() => ({ status: 429, retryAfter: "3", text: "" }));
    const t = makeClient({ maxRetries: 2 }, net);
    const err = await t.client.getUptime("2026-07").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBe(3000);
    expect(t.net.calls).toHaveLength(3);
  });

  it("5xx retries with exponential backoff, then UpstreamError", async () => {
    const net = fixtureNet(() => ({ status: 503, text: "" }));
    const t = makeClient({ maxRetries: 3, baseDelayMs: 1000 }, net);
    await expect(t.client.getUptime("2026-07")).rejects.toBeInstanceOf(UpstreamError);
    expect(t.net.calls).toHaveLength(4);
    expect(t.sleeps.filter((ms) => ms >= 1000 && ms <= 4000)).toEqual([1000, 2000, 4000]);
  });

  it("403 from the CDN is NOT retried and not worked around", async () => {
    const net = fixtureNet(() => ({ status: 403, text: "<HTML>Access Denied</HTML>" }));
    const t = makeClient({}, net);
    const err = await t.client.getUptime("2026-07").catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).status).toBe(403);
    expect(t.net.calls).toHaveLength(1);
  });
});

describe("changed page structure (mutated fixtures)", () => {
  const withBody = (text: string) => makeClient({}, fixtureNet(() => ({ status: 200, text })));

  it("a renamed column -> StructureChangedError naming it", async () => {
    const mutated = fixture("top50-remitter-2026-08").replace(/approved_percent/g, "approval_rate");
    const err = await withBody(mutated).client.getBankTable("remitter", "2026-08").catch((e) => e);
    expect(err).toBeInstanceOf(StructureChangedError);
    expect((err as Error).message).toContain("approved_percent");
  });

  it("a reordered column does not break parsing (no positional reliance)", async () => {
    const body = JSON.parse(fixture("top50-remitter-2026-08"));
    body.data.table_headers.headers.reverse();
    body.data.results = body.data.results.map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).reverse()));
    const table = await withBody(JSON.stringify(body)).client.getBankTable("remitter", "2026-08");
    expect(table[0]!.bank).toBe("State Bank of India");
    expect(table[0]!.approvedPct).toBe(90.78);
  });

  it("NPCI's '-' for 'no debit reversals' becomes undefined, not 0 and not an error", async () => {
    const table = await makeClient().client.getBankTable("remitter", "2026-08");
    const noReversals = table.filter((b) => b.debitReversalCountMn === undefined);
    expect(noReversals).toHaveLength(2);
    expect(noReversals.every((b) => b.debitReversalSuccessPct === undefined)).toBe(true);
  });

  it("a non-numeric value -> StructureChangedError", async () => {
    const mutated = fixture("top50-remitter-2026-08").replace('"90.78%"', '"n/a"');
    await expect(withBody(mutated).client.getBankTable("remitter", "2026-08")).rejects.toBeInstanceOf(
      StructureChangedError,
    );
  });

  it("HTML instead of JSON -> StructureChangedError", async () => {
    await expect(withBody("<html>maintenance</html>").client.getBankTable("remitter", "2026-08")).rejects.toBeInstanceOf(
      StructureChangedError,
    );
  });

  it("missing results array -> StructureChangedError", async () => {
    await expect(withBody('{"status":200,"data":{}}').client.getUptime("2026-07")).rejects.toBeInstanceOf(
      StructureChangedError,
    );
  });

  it("uptime: a dropped column -> StructureChangedError", async () => {
    const mutated = fixture("uptime-2026-07").replace(/no_of_incidents/g, "incident_count");
    await expect(withBody(mutated).client.getUptime("2026-07")).rejects.toBeInstanceOf(StructureChangedError);
  });
});

describe("cache and throttling", () => {
  it("second identical call is served from disk with no network request", async () => {
    const t = makeClient();
    await t.client.getBankTable("remitter", "2026-08");
    await t.client.getBankTable("remitter", "2026-08");
    expect(t.net.calls).toHaveLength(1);
    expect(t.client.liveRequests).toBe(1);
  });

  it("an expired entry is refetched", async () => {
    const t = makeClient({ ttlMs: 1000 });
    await t.client.getUptime("2026-07");
    t.clock.t += 5000;
    await t.client.getUptime("2026-07");
    expect(t.net.calls).toHaveLength(2);
  });

  it("'no data' answers are cached too, so unpublished months are not re-requested", async () => {
    const t = makeClient();
    await t.client.getUptime("2026-08").catch(() => undefined);
    await t.client.getUptime("2026-08").catch(() => undefined);
    expect(t.net.calls).toHaveLength(1);
  });

  it("consecutive live requests are spaced by the minimum interval", async () => {
    const t = makeClient({ minIntervalMs: 5000 });
    await t.client.getUptime("2026-07");
    await t.client.getBankTable("remitter", "2026-08");
    expect(t.net.calls).toHaveLength(2);
    expect(t.sleeps.some((ms) => ms >= 4000)).toBe(true);
  });

  it("the User-Agent identifies the project and contact", async () => {
    const t = makeClient();
    await t.client.getUptime("2026-07");
    expect(t.net.userAgents[0]).toBe("npci-stats-wrapper/0.1 (contact: tests@example.invalid)");
  });

  it("refuses live requests without a contact", async () => {
    const saved = process.env.NPCI_CONTACT;
    delete process.env.NPCI_CONTACT;
    try {
      const net = fixtureNet();
      const client = new NpciClient({ fetcher: net.fetcher, cacheDir: mkdtempSync(path.join(os.tmpdir(), "npci-test-")) });
      await expect(client.getUptime("2026-07")).rejects.toBeInstanceOf(ValidationError);
      expect(net.calls).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.NPCI_CONTACT = saved;
    }
  });
});

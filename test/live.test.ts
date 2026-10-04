import { describe, expect, it } from "vitest";
import { NpciClient } from "../src/client.js";

// Opt-in: makes ONE real request to NPCI. Needs NPCI_LIVE=1 and NPCI_CONTACT=<your email>.
const enabled = process.env.NPCI_LIVE === "1" && !!process.env.NPCI_CONTACT;

describe.skipIf(!enabled)("live smoke test (1 request)", () => {
  it("top-50 remitter table for 2026-08 has the expected shape", async () => {
    const client = new NpciClient({ cacheDir: ".cache/live-smoke" });
    const table = await client.getBankTable("remitter", "2026-08");
    expect(table.length).toBeGreaterThanOrEqual(40);
    expect(table.some((b) => b.bank === "State Bank of India")).toBe(true);
    expect(client.liveRequests).toBeLessThanOrEqual(1);
  });
});

import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { UpiStatsService } from "../src/service.js";
import { fixtureNet, makeClient } from "./helpers.js";

const app = (net = fixtureNet()) => buildServer(new UpiStatsService(makeClient({}, net).client));

describe("HTTP API", () => {
  it("200 with bank stats", async () => {
    const res = await app().inject({ url: "/bank-stats?bank=state bank of india&month=2026-08" });
    expect(res.statusCode).toBe(200);
    expect(res.json().bank).toBe("State Bank of India");
  });

  it("400 for bad input", async () => {
    const res = await app().inject({ url: "/bank-stats?bank=sbi&month=August" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
  });

  it("400 for a missing parameter", async () => {
    expect((await app().inject({ url: "/uptime" })).statusCode).toBe(400);
  });

  it("404 for a month NPCI has not published", async () => {
    const res = await app().inject({ url: "/uptime?month=2026-08" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("502 when NPCI's structure has changed", async () => {
    const res = await app(fixtureNet(() => ({ status: 200, text: "<html></html>" }))).inject({ url: "/uptime?month=2026-07" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("upstream_structure_changed");
  });

  it("429 when NPCI keeps rate limiting", async () => {
    const net = fixtureNet(() => ({ status: 429, text: "" }));
    const server = buildServer(new UpiStatsService(makeClient({ maxRetries: 1 }, net).client));
    expect((await server.inject({ url: "/uptime?month=2026-07" })).statusCode).toBe(429);
  });

  it("compare and worst-by-td work over HTTP", async () => {
    const a = app();
    const cmp = await a.inject({ url: "/compare?banks=state bank of india,hdfc&month=2026-08" });
    expect(cmp.json()).toHaveLength(2);
    const worst = await a.inject({ url: "/worst-by-td?month=2026-08&n=3" });
    expect(worst.json()).toHaveLength(3);
  });
});

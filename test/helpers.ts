import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NpciClient, type ClientOptions } from "../src/client.js";
import type { Fetcher, RawResponse } from "../src/http.js";

export const fixture = (name: string): string =>
  readFileSync(path.resolve("fixtures", `${name}.json`), "utf8");

const ROUTES: Record<string, string> = {
  "remitter:Aug:2026": "top50-remitter-2026-08",
  "beneficiary:Aug:2026": "top50-beneficiary-2026-08",
  "remitter:Sep:2026": "top50-remitter-2026-09-nodata",
  "autopay:execution:Aug:2026": "autopay-execution-2026-08",
  "autopay:reg:Aug:2026": "autopay-reg-2026-08",
  "uptime:July:2026": "uptime-2026-07",
  "uptime:August:2026": "uptime-2026-08-nodata",
};

export function routeKey(url: string): string {
  const u = new URL(url);
  const p = u.searchParams;
  const prefix = p.get("product_name") === "Autopay" ? "autopay:" : "";
  return u.pathname.includes("get-statistics")
    ? `${prefix}${p.get("type_name")}:${p.get("month")}:${p.get("year")}`
    : `uptime:${p.get("month")}:${p.get("year")}`;
}

export interface FakeNet {
  fetcher: Fetcher;
  calls: string[];
  userAgents: string[];
}

/** Serves recorded fixtures. Any request without a fixture fails the test instead of hitting the network. */
export function fixtureNet(override?: (url: string, call: number) => RawResponse | undefined): FakeNet {
  const net: FakeNet = {
    calls: [],
    userAgents: [],
    fetcher: async (url, { userAgent }) => {
      net.calls.push(url);
      net.userAgents.push(userAgent);
      const forced = override?.(url, net.calls.length);
      if (forced) return forced;
      const name = ROUTES[routeKey(url)];
      if (!name) throw new Error(`No fixture for ${url}`);
      return { status: 200, text: fixture(name) };
    },
  };
  return net;
}

export interface TestClient {
  client: NpciClient;
  net: FakeNet;
  sleeps: number[];
  clock: { t: number };
}

export function makeClient(opts: ClientOptions = {}, net: FakeNet = fixtureNet()): TestClient {
  const sleeps: number[] = [];
  const clock = { t: 1_000_000 };
  const client = new NpciClient({
    contact: "tests@example.invalid",
    cacheDir: mkdtempSync(path.join(os.tmpdir(), "npci-test-")),
    fetcher: net.fetcher,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
    now: () => clock.t,
    ...opts,
  });
  return { client, net, sleeps, clock };
}

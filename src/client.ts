import path from "node:path";
import { DiskCache } from "./cache.js";
import { StructureChangedError, UpstreamError, ValidationError } from "./errors.js";
import { type Fetcher, defaultFetcher, withRetries } from "./http.js";
import { parseAutopayTable, parseBankTable, parseUptime } from "./parse.js";
import type { AutopayKind, AutopayStats, BankSide, BankStats, UptimeRecord } from "./types.js";

const BASE = "https://www.npci.org.in/api";
const ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HOUR = 3_600_000;

export interface ClientOptions {
  /** Email or URL that NPCI can use to reach the operator. Required for live requests. */
  contact?: string;
  cacheDir?: string;
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  ttlMs?: number;
  negativeTtlMs?: number;
}

export function parseMonth(month: string): { year: number; index: number } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new ValidationError(`Invalid month "${month}". Use YYYY-MM, e.g. 2026-08.`);
  return { year: Number(m[1]), index: Number(m[2]) - 1 };
}

export function addMonths(month: string, delta: number): string {
  const { year, index } = parseMonth(month);
  const total = year * 12 + index + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export class NpciClient {
  private readonly cache: DiskCache;
  private readonly fetcher: Fetcher;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastRequestAt = 0;
  private readonly o: Required<Omit<ClientOptions, "contact" | "fetcher" | "sleep" | "now" | "cacheDir">>;
  private readonly contact?: string;
  /** Number of requests that actually went to the network (cache hits excluded). */
  liveRequests = 0;

  constructor(opts: ClientOptions = {}) {
    this.contact = opts.contact ?? process.env.NPCI_CONTACT;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.cache = new DiskCache(opts.cacheDir ?? path.resolve(".cache", "npci"), this.now);
    this.o = {
      minIntervalMs: opts.minIntervalMs ?? 5000,
      maxRetries: opts.maxRetries ?? 3,
      baseDelayMs: opts.baseDelayMs ?? 2000,
      timeoutMs: opts.timeoutMs ?? 15000,
      ttlMs: opts.ttlMs ?? 24 * HOUR,
      negativeTtlMs: opts.negativeTtlMs ?? 6 * HOUR,
    };
  }

  async getBankTable(side: BankSide, month: string): Promise<BankStats[]> {
    const { year, index } = parseMonth(month);
    const url =
      `${BASE}/ecosystem-statistics/get-statistics?product_name=UPI&tab_name=top50-member` +
      `&type_name=${side}&year=${year}&month=${ABBR[index]}&page_no=1&sort_by=asc&size=50&locale=en`;
    const body = await this.getJson(url);
    return parseBankTable(body, side, month);
  }

  async getAutopayTable(kind: AutopayKind, month: string): Promise<AutopayStats[]> {
    const { year, index } = parseMonth(month);
    const type = kind === "execution" ? "execution" : "reg";
    const url =
      `${BASE}/ecosystem-statistics/get-statistics?product_name=Autopay&tab_name=top50-remitter` +
      `&type_name=${type}&year=${year}&month=${ABBR[index]}&page_no=1&sort_by=asc&size=50&locale=en`;
    return parseAutopayTable(await this.getJson(url), kind, month);
  }

  async getUptime(month: string): Promise<UptimeRecord> {
    const { year, index } = parseMonth(month);
    const url =
      `${BASE}/product-statistic/tab/detail?product_name=upi&tab_name=upi-uptime&excel_type=uptime` +
      `&month=${FULL[index]}&year=${year}&page_no=1&page_size=10&locale=en`;
    const body = await this.getJson(url);
    return parseUptime(body, month);
  }

  private async getJson(url: string): Promise<unknown> {
    const hit = (await this.cache.get("pos:" + url, this.o.ttlMs)) ?? (await this.cache.get("neg:" + url, this.o.negativeTtlMs));
    const text = hit ?? (await this.fetchLive(url));
    try {
      return JSON.parse(text);
    } catch {
      throw new StructureChangedError("NPCI response was not JSON");
    }
  }

  private async fetchLive(url: string): Promise<string> {
    if (!this.contact) {
      throw new ValidationError(
        "Set NPCI_CONTACT (an email NPCI can reach) before making live requests. It is sent in the User-Agent.",
      );
    }
    const userAgent = `npci-stats-wrapper/0.1 (contact: ${this.contact})`;
    const wait = this.lastRequestAt + this.o.minIntervalMs - this.now();
    if (this.lastRequestAt > 0 && wait > 0) await this.sleep(wait);

    const res = await withRetries(
      async () => {
        this.lastRequestAt = this.now();
        this.liveRequests++;
        return this.fetcher(url, { userAgent, timeoutMs: this.o.timeoutMs });
      },
      { maxRetries: this.o.maxRetries, baseDelayMs: this.o.baseDelayMs, sleep: this.sleep, now: this.now },
    );

    if (res.status === 403) {
      throw new UpstreamError(
        "NPCI's CDN denied the request (HTTP 403). Not retried: this client does not work around access controls.",
        403,
      );
    }
    if (res.status !== 200) throw new UpstreamError(`Unexpected HTTP ${res.status} from NPCI`, res.status);

    let notFound = false;
    try {
      notFound = (JSON.parse(res.text) as { status?: number }).status === 404;
    } catch {
      throw new StructureChangedError("NPCI response was not JSON");
    }
    await this.cache.set((notFound ? "neg:" : "pos:") + url, res.text);
    return res.text;
  }
}


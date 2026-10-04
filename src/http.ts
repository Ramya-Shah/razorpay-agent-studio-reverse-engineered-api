import { RateLimitedError, UpstreamError } from "./errors.js";

export interface RawResponse {
  status: number;
  retryAfter?: string | null;
  text: string;
}

export type Fetcher = (url: string, init: { userAgent: string; timeoutMs: number }) => Promise<RawResponse>;

export const defaultFetcher: Fetcher = async (url, { userAgent, timeoutMs }) => {
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, retryAfter: res.headers.get("retry-after"), text: await res.text() };
};

export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export async function withRetries(
  attempt: () => Promise<RawResponse>,
  { maxRetries, baseDelayMs, sleep, now }: RetryOptions,
): Promise<RawResponse> {
  for (let n = 0; ; n++) {
    let res: RawResponse | undefined;
    let networkError: unknown;
    try {
      res = await attempt();
    } catch (err) {
      networkError = err;
    }
    const retryable = networkError !== undefined || res!.status === 429 || res!.status >= 500;
    if (!retryable) return res!;
    if (n >= maxRetries) {
      if (networkError !== undefined) throw new UpstreamError(`Network error after ${n + 1} attempts: ${String(networkError)}`);
      if (res!.status === 429) throw new RateLimitedError("NPCI rate limited the request", parseRetryAfter(res!.retryAfter, now()));
      throw new UpstreamError(`NPCI returned HTTP ${res!.status} after ${n + 1} attempts`, res!.status);
    }
    const hinted = res ? parseRetryAfter(res.retryAfter, now()) : undefined;
    await sleep(hinted ?? baseDelayMs * 2 ** n);
  }
}

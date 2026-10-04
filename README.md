# UPI Bank Reliability API (reverse-engineered from NPCI)

Razorpay Forward-Deployed Engineer (Agent Studio), take-home Option 1: *reverse-engineer an API*.

## The request vs the real need

**Request:** "NPCI publishes bank-level UPI statistics only as web pages. Build an API for them."

**Real need:** a merchant's agent sees a failed UPI AutoPay debit and must decide the next step: retry now, retry later, stop, or ask the customer to move their mandate. The transaction's own gateway error code is the primary diagnosis. This API adds **bank-level context** the agent does not have today:

- **Retry timing and attempts:** a payer bank with a high technical-decline rate deserves a different retry plan than one with almost none.
- **Chronically unreliable banks:** flag them so the merchant can nudge affected customers.
- **Benchmarking:** compare the merchant's failure rate against the ecosystem baseline.

**What it cannot do:** the data is monthly. It cannot support "the bank is down right now", and it says nothing about one specific payment. See [LIMITATIONS.md](LIMITATIONS.md).

## What it is

NPCI has no documented public API for these statistics. Its website loads them from undocumented JSON endpoints, which this project wraps in a typed, cached, throttled client plus a small HTTP API.

| Tool | Returns |
|---|---|
| `list_banks(month, side)` | the 50 banks in NPCI's monthly table |
| `get_bank_stats(bank, month, side)` | approved %, business-decline %, technical-decline %, debit-reversal success |
| `compare_banks(banks, month, side)` | 2-10 banks side by side |
| `worst_banks_by_td(month, n, side)` | banks with the highest technical-decline rate |
| `monthly_trend(bank, metric, months, side)` | one metric across 2-12 months (`null` where unpublished) |
| `get_uptime(month)` | NPCI's UPI uptime %, unscheduled downtime, incidents |

`side` is `remitter` (payer's bank, the one that debits; default) or `beneficiary`. Months are `YYYY-MM`. [mcp/tools.json](mcp/tools.json) describes the same tools as JSON-schema tool definitions so an Agent Studio agent can call them.

## Setup, run, test

Requires Node 20+.

```bash
npm install
npm test          # offline: runs against recorded fixtures, no network
npm run typecheck
```

`npm test` is the one command a reviewer needs. It makes **zero** network requests.

Optional live smoke test (one real request to NPCI):

```bash
# bash
NPCI_LIVE=1 NPCI_CONTACT=you@example.com npm run test:live
# PowerShell
$env:NPCI_LIVE="1"; $env:NPCI_CONTACT="you@example.com"; npm run test:live
```

Run the HTTP API:

```bash
NPCI_CONTACT=you@example.com npm run serve     # http://127.0.0.1:3000
curl "http://127.0.0.1:3000/bank-stats?bank=State%20Bank%20of%20India&month=2026-08"
```

Endpoints: `/banks`, `/bank-stats`, `/compare`, `/worst-by-td`, `/trend`, `/uptime`. Errors come back as `{ "error": { "code", "message" } }` with 400 (bad input), 404 (no such bank/month), 429/502 (upstream problems).

`NPCI_CONTACT` is required for live requests and is sent in the User-Agent (`npci-stats-wrapper/0.1 (contact: ...)`) so NPCI can reach whoever is calling. It is never stored in the repo.

## What the tests cover

- normal results, unknown bank, month NPCI has not published, ambiguous bank name
- bad input (month format, empty bank, `n` out of range, unknown metric/side), rejected before any network call
- mocked 429 with `Retry-After`, persistent 429, 5xx exponential backoff, and a 403 that is deliberately not retried
- mutated fixtures: renamed column, reordered columns (still parses), non-numeric value, HTML instead of JSON, missing results -> `StructureChangedError`
- cache hit, TTL expiry, caching of "no data" answers, request spacing
- HTTP status mapping, and that `mcp/tools.json` matches the service

## Client design

Typed (`zod`-validated) parsing that finds columns by NPCI's `header_key`, never by position. Custom errors: `ValidationError`, `NotFoundError`, `RateLimitedError`, `UpstreamError`, `StructureChangedError`. Timeouts, retries with exponential backoff on 5xx/429 (honouring `Retry-After`), at least 5 s between live requests, and a 24-hour on-disk cache (`.cache/`, git-ignored).

## Access, robots.txt, and terms: plain disclosure

NPCI's robots.txt allowlists named crawlers and disallows everything else, so this client is **not permitted** by it. I chose to proceed with a small footprint and an honest identity (no spoofed crawler or browser User-Agent, no attempt to evade blocks), and I would stop if I met a CAPTCHA, login or token. NPCI's terms of use contain no explicit ban on automated access, but that is not permission. Details and the recommended fix are in [LIMITATIONS.md](LIMITATIONS.md).

Only public aggregate statistics are used. There are no credentials, logins or customer data, in the repo or its history. `fixtures/` holds recorded public responses.

## Assumptions

- "Top 50" tables are the right coverage for the banks that matter to a merchant's payers.
- Technical declines (TD) are the retry-relevant signal; business declines (BD) are customer-side and are not fixed by retrying.
- The undocumented endpoints behave as observed on 2026-10-04.

## Not done

AutoPay-specific tables (which exist on NPCI's site) are not wrapped yet, and the decision layer (retry recommendations) is not built. See [LIMITATIONS.md](LIMITATIONS.md) for the impact metric that would evaluate it.

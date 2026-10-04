# Limitations, long-term fix, and impact metric

## Limitations

1. **Monthly, not real time.** Every number is a month-long average. This API cannot say "the bank is down right now". Do not use it for live routing or incident detection.
2. **Bank-level, not customer- or transaction-level.** It gives context for a retry decision. The transaction's own gateway error code remains the primary diagnosis.
3. **Not AutoPay-specific yet.** The tables are NPCI's overall UPI top-50 remitter/beneficiary figures. NPCI also publishes AutoPay statistics (top-50 remitter banks, PSP-wise registration and execution), which I confirmed exist but have **not** wrapped. AutoPay mandates may behave differently from one-time UPI payments.
4. **Brittle to upstream change.** The site's front end calls undocumented JSON endpoints. Nothing promises they stay stable. The parser reads columns by name (`header_key`), not position, and raises `StructureChangedError` when an expected column or value shape disappears. That makes failures loud, not silent. It cannot make them go away.
5. **Access can be cut off without notice.** During development NPCI's CDN (Akamai) returned HTTP 403 to some User-Agent strings and 200 to others from the same machine. I do not know the rule. The client sends an honest User-Agent with a contact email (`NPCI_CONTACT`), treats a 403 as final, and does not retry or disguise itself.
6. **robots.txt and terms.** NPCI's robots.txt allowlists named crawlers and ends with `Disallow: /` for everyone else, so this client is not permitted by it. I proceeded knowingly with a deliberately small footprint: at least 5 seconds between requests, a 24-hour on-disk cache, "no data" answers cached too, and fixtures recorded once (5 requests). Exploring the site in a browser and with curl during development added a few dozen requests in total, some of them denied. NPCI's terms of use (checked 2026-10-04) contain no explicit ban on automated access, only a general disclaimer and a rule about linking and framing the site, but I am not a lawyer and silence is not permission.
7. **Freshness is not guaranteed.** The latest month is often missing. Uptime for August 2026 was still absent on 4 October. Missing months surface as `NotFoundError` (or `null` in trends).
8. **Read-only.** There are no write operations, and nothing is stored beyond the local cache.
9. **Data quirks.** Only the top 50 banks are listed, so smaller banks return "not found" even though they exist. NPCI prints `-` for banks with no debit reversals; these become `undefined`, not 0.
10. **Prior art.** A third-party portal (dataful.in) republishes a static copy of this dataset. It offers no live query API and no uptime data, but it exists, so "no public API" is accurate for NPCI itself only.

## The one recommended long-term fix

**Ask NPCI for an official, documented statistics feed, or written permission to use the current one.** NPCI's site lists an API programme under Developer Studio; I have not verified whether it covers statistics, so the first step is simply to ask.

Why this one: it removes the largest risks together. There would be no robots.txt conflict, no CDN blocking, a stable schema with change notice, and a clear answer on reuse. Every other fix (better parsing, proxies, more caching) only manages the symptoms, and the ones that avoid blocking would mean evading access controls, which this project will not do.

## Impact metric (how to know the retry advice helps)

For failed UPI AutoPay debits, compare **advice-driven retries** against a **naive baseline** (for example: retry at fixed intervals, same attempt count for every bank). Randomly assign failed mandates to each arm.

- **Recovery rate** = failed debits eventually collected within N days ÷ all failed debits in the arm.
- **Attempts per recovery** = total retry attempts ÷ recovered debits (lower is better; fewer wasted attempts and customer notifications).
- **Guardrails:** complaint or dispute rate, and share of customers who churned after a failure.

Only count failures whose gateway error code is the kind retrying can fix (for example technical declines), otherwise customer-side failures drown out the signal. This repo does not run that experiment, since it needs real merchant data. It only defines the measurement.

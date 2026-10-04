# UPI Bank Reliability API (reverse-engineered from NPCI)

> **Status: work in progress.** This repo was created at the start of the 48-hour window so the link is valid. The full implementation, tests and write-up will land here within a few hours. This README will be expanded then.

Assignment: Razorpay Forward-Deployed Engineer (Agent Studio), Option 1 - *Reverse-engineer an API*.

## Problem

A merchant's agent sees a failed UPI AutoPay debit and must decide what to do next. The transaction's own gateway error code is the primary diagnosis. This API adds **bank-level context** from NPCI's public monthly statistics:

- pick retry timing and attempt count based on how reliable the payer's bank is
- flag chronically unreliable banks so the merchant can nudge customers to move their mandate
- benchmark the merchant's own failure rate against the ecosystem baseline

It cannot say "the bank is down right now". The data is monthly, not real time.

## Target

NPCI's public statistics pages (npci.org.in) have no documented public API. The site's own frontend calls undocumented JSON endpoints for:

- UPI top-50 remitter / beneficiary bank performance (volume, approved %, BD %, TD %, debit reversals)
- UPI AutoPay ecosystem statistics
- UPI monthly uptime

This project wraps those into a small, typed, cached, rate-limited API.

## Planned endpoints

`list_banks`, `get_bank_stats(bank, month)`, `compare_banks(banks, month)`, `worst_banks_by_td(month, n)`, `monthly_trend(bank, metric, months)`, `get_uptime(month)`

## Stack

TypeScript, Node.js 20+, zod, Fastify, vitest. An MCP tool spec is planned so an Agent Studio agent can call the tools.

## Access and robots.txt disclosure

NPCI's robots.txt allowlists named crawlers and disallows everything else. I chose to proceed with a deliberately light footprint: an honest User-Agent identifying this project, several seconds between requests, aggressive on-disk caching, and minimal live requests. I do not spoof any allowlisted crawler. NPCI's terms of use contain no explicit prohibition on automated access, but this remains a risk, covered in the limitations note. The long-term fix is an official data feed or written permission from NPCI.

Only publicly accessible aggregate statistics are used. No credentials, login, or customer data is involved.

## Setup / run / test

Coming with the implementation.

## Layout (planned)

```
src/        client, parsers, API server, MCP spec
test/       offline tests against recorded fixtures, opt-in live smoke test
fixtures/   recorded public NPCI responses
LIMITATIONS.md
```

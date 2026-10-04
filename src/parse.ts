import { z } from "zod";
import { NotFoundError, StructureChangedError } from "./errors.js";
import type { BankSide, BankStats, UptimeRecord } from "./types.js";

const Header = z.object({ header_key: z.string(), header_name: z.string().optional() }).passthrough();

const Envelope = z
  .object({ status: z.number(), message: z.string().optional(), data: z.unknown().optional() })
  .passthrough();

const TableData = z
  .object({
    table_headers: z.object({ headers: z.array(Header) }).passthrough(),
    results: z.array(z.record(z.unknown())),
  })
  .passthrough();

const UptimeData = z
  .object({
    table_headers: z.object({ headers: z.array(Header) }).passthrough(),
    downtime_headers: z.object({ headers: z.array(Header) }).passthrough(),
    results: z.array(z.record(z.unknown())),
  })
  .passthrough();

function unwrap(body: unknown, what: string): unknown {
  const env = Envelope.safeParse(body);
  if (!env.success) throw new StructureChangedError(`${what}: unexpected response envelope`);
  if (env.data.status === 404) throw new NotFoundError(`${what}: NPCI has no data for this request`);
  if (env.data.status !== 200) throw new StructureChangedError(`${what}: unexpected status ${env.data.status} in body`);
  return env.data.data;
}

function requireKeys(headers: { header_key: string }[], keys: string[], what: string): void {
  const present = new Set(headers.map((h) => h.header_key));
  const missing = keys.filter((k) => !present.has(k));
  if (missing.length) {
    throw new StructureChangedError(`${what}: expected column(s) not found: ${missing.join(", ")}`);
  }
}

function num(value: unknown, field: string, what: string): number {
  const cleaned = typeof value === "string" ? value.replace(/[%,\s]/g, "") : value;
  const n = typeof cleaned === "number" ? cleaned : Number(cleaned);
  if (cleaned === "" || cleaned === null || cleaned === undefined || !Number.isFinite(n)) {
    throw new StructureChangedError(`${what}: could not read a number from "${field}" (got ${JSON.stringify(value)})`);
  }
  return n;
}

function optNum(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const n = Number(String(value).replace(/[%,\s]/g, ""));
  return String(value).trim() === "" || !Number.isFinite(n) ? undefined : n;
}

const BANK_KEY: Record<BankSide, string> = { remitter: "upi_remitter_banks", beneficiary: "upi_beneficiary_banks" };
const COMMON = ["total_volume_in_mn", "approved_percent", "bd_percent", "td_percent"];
const REQUIRED: Record<BankSide, string[]> = {
  remitter: [BANK_KEY.remitter, ...COMMON, "total_debit_reversal_count_in_mn", "debit_reversal_success_percent"],
  beneficiary: [BANK_KEY.beneficiary, ...COMMON],
};

export function parseBankTable(body: unknown, side: BankSide, month: string): BankStats[] {
  const what = `${side} top-50 table ${month}`;
  const parsed = TableData.safeParse(unwrap(body, what));
  if (!parsed.success) throw new StructureChangedError(`${what}: table headers or results missing`);
  const { table_headers, results } = parsed.data;
  requireKeys(table_headers.headers, REQUIRED[side], what);
  if (results.length === 0) throw new NotFoundError(`${what}: table is empty`);

  return results.map((row, i) => {
    const name = row[BANK_KEY[side]];
    if (typeof name !== "string" || !name.trim()) {
      throw new StructureChangedError(`${what}: row ${i + 1} has no bank name`);
    }
    const stats: BankStats = {
      bank: name.trim(),
      month,
      side,
      rank: i + 1,
      volumeMn: num(row.total_volume_in_mn, "total_volume_in_mn", what),
      approvedPct: num(row.approved_percent, "approved_percent", what),
      bdPct: num(row.bd_percent, "bd_percent", what),
      tdPct: num(row.td_percent, "td_percent", what),
    };
    if (side === "remitter") {
      // NPCI prints "-" for banks with no debit reversals; the 0.00% success rate beside it is not meaningful.
      const rawCount = row.total_debit_reversal_count_in_mn;
      if (!(typeof rawCount === "string" && /^[-–—]$/.test(rawCount.trim()))) {
        stats.debitReversalCountMn = num(rawCount, "total_debit_reversal_count_in_mn", what);
        stats.debitReversalSuccessPct = num(row.debit_reversal_success_percent, "debit_reversal_success_percent", what);
      }
      stats.udirAutoUpdateSrPct = optNum(row.udir_auto_update_sr_percent);
      stats.udirRefundSrPct = optNum(row.udir_refund_sr_percent);
    } else {
      stats.deemedApprovedPct = optNum(row.deemed_approved_percent);
    }
    return stats;
  });
}

function nilToZero(value: unknown, field: string, what: string): number {
  if (typeof value === "string" && value.trim().toUpperCase() === "NIL") return 0;
  return num(typeof value === "string" ? value.replace(/[^\d.%-]/g, "") : value, field, what);
}

export function parseUptime(body: unknown, month: string): UptimeRecord {
  const what = `uptime ${month}`;
  const parsed = UptimeData.safeParse(unwrap(body, what));
  if (!parsed.success) throw new StructureChangedError(`${what}: table headers or results missing`);
  const { table_headers, downtime_headers, results } = parsed.data;
  requireKeys(table_headers.headers, ["month", "npci_uptime_for_upi"], what);
  requireKeys(downtime_headers.headers, ["unscheduled_downtime", "no_of_incidents"], what);
  const row = results[0];
  if (!row) throw new NotFoundError(`${what}: no uptime row`);
  return {
    month,
    uptimePct: num(row.npci_uptime_for_upi, "npci_uptime_for_upi", what),
    unscheduledDowntimeMins: nilToZero(row.unscheduled_downtime, "unscheduled_downtime", what),
    incidents: nilToZero(row.no_of_incidents, "no_of_incidents", what),
  };
}

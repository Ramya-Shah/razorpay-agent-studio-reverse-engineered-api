import type { NpciClient } from "./client.js";
import { parseMonth } from "./client.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { BankSide, BankStats, TrendMetric, UptimeRecord } from "./types.js";

const SIDES: BankSide[] = ["remitter", "beneficiary"];
const METRICS: TrendMetric[] = ["approvedPct", "bdPct", "tdPct", "volumeMn", "debitReversalSuccessPct"];

function checkSide(side: string): BankSide {
  if (!SIDES.includes(side as BankSide)) throw new ValidationError(`side must be one of: ${SIDES.join(", ")}`);
  return side as BankSide;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findBank(table: BankStats[], query: string): BankStats {
  const q = norm(query);
  if (!q) throw new ValidationError("bank must not be empty");
  const exact = table.filter((b) => norm(b.bank) === q);
  if (exact.length === 1) return exact[0]!;
  const partial = table.filter((b) => norm(b.bank).includes(q));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new ValidationError(`"${query}" is ambiguous. Matches: ${partial.map((b) => b.bank).join("; ")}`);
  }
  throw new NotFoundError(`No bank matching "${query}" in the top-50 table for ${table[0]?.month ?? "that month"}`);
}

export class UpiStatsService {
  constructor(private readonly client: NpciClient) {}

  async listBanks(month: string, side: string = "remitter"): Promise<{ month: string; side: BankSide; banks: string[] }> {
    const s = checkSide(side);
    const table = await this.client.getBankTable(s, month);
    return { month, side: s, banks: table.map((b) => b.bank) };
  }

  async getBankStats(bank: string, month: string, side: string = "remitter"): Promise<BankStats> {
    return findBank(await this.client.getBankTable(checkSide(side), month), bank);
  }

  async compareBanks(banks: string[], month: string, side: string = "remitter"): Promise<BankStats[]> {
    if (!Array.isArray(banks) || banks.length < 2 || banks.length > 10) {
      throw new ValidationError("banks must contain between 2 and 10 names");
    }
    const table = await this.client.getBankTable(checkSide(side), month);
    return banks.map((b) => findBank(table, b));
  }

  async worstBanksByTd(month: string, n = 5, side: string = "remitter"): Promise<BankStats[]> {
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new ValidationError("n must be an integer between 1 and 50");
    const table = await this.client.getBankTable(checkSide(side), month);
    return [...table].sort((a, b) => b.tdPct - a.tdPct || b.volumeMn - a.volumeMn).slice(0, n);
  }

  async monthlyTrend(
    bank: string,
    metric: string,
    months: string[],
    side: string = "remitter",
  ): Promise<{ bank: string; metric: TrendMetric; points: { month: string; value: number | null }[] }> {
    if (!METRICS.includes(metric as TrendMetric)) throw new ValidationError(`metric must be one of: ${METRICS.join(", ")}`);
    if (!Array.isArray(months) || months.length < 2 || months.length > 12) {
      throw new ValidationError("months must contain between 2 and 12 entries (YYYY-MM)");
    }
    months.forEach(parseMonth);
    const s = checkSide(side);
    const m = metric as TrendMetric;
    const points: { month: string; value: number | null }[] = [];
    let resolved = "";
    for (const month of [...new Set(months)].sort()) {
      try {
        const stats = findBank(await this.client.getBankTable(s, month), bank);
        resolved = stats.bank;
        points.push({ month, value: (stats[m] as number | undefined) ?? null });
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
        points.push({ month, value: null });
      }
    }
    if (points.every((p) => p.value === null)) {
      throw new NotFoundError(`No data for "${bank}" and metric ${metric} in the requested months`);
    }
    return { bank: resolved, metric: m, points };
  }

  getUptime(month: string): Promise<UptimeRecord> {
    return this.client.getUptime(month);
  }
}

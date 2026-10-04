import type { AutopayStats, FailureType, RetryAdvice, TdBand } from "./types.js";

export function percentile(values: number[], p: number): number {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]!;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function band(td: number, tds: number[]): TdBand {
  if (td > percentile(tds, 0.9)) return "high";
  if (td > percentile(tds, 0.75)) return "elevated";
  if (td > percentile(tds, 0.5)) return "moderate";
  return "low";
}

const CAVEATS = [
  "Based on monthly averages: this cannot tell whether the bank is having a problem right now.",
  "The transaction's own gateway error code is the primary diagnosis; use this only as bank-level context.",
  "Retry windows and attempt caps are heuristic defaults, not values fitted to recovery outcomes. Measure them (see LIMITATIONS.md).",
];

export interface AdviceInput {
  bank: string;
  month: string;
  failureType: FailureType;
  /** AutoPay mandate-execution table for `month`. */
  table: AutopayStats[];
  /** Same table for earlier months (any that NPCI has published). Used only for the chronic-unreliability flag. */
  earlierTables?: AutopayStats[][];
}

export function buildRetryAdvice({ bank, month, failureType, table, earlierTables = [] }: AdviceInput): RetryAdvice {
  const row = table.find((r) => r.bank === bank);
  if (!row) throw new Error(`buildRetryAdvice: ${bank} not in table`);

  const tds = table.map((r) => r.tdPct);
  const bds = table.map((r) => r.bdPct);
  const approved = table.map((r) => r.approvedPct);
  const baseBand = band(row.tdPct, tds);

  const history = [table, ...earlierTables]
    .map((t) => {
      const r = t.find((x) => x.bank === bank);
      return r ? r.tdPct > percentile(t.map((x) => x.tdPct), 0.75) : undefined;
    })
    .filter((v): v is boolean => v !== undefined);
  const chronic = history.length >= 2 ? history.filter(Boolean).length >= Math.ceil((2 * history.length) / 3) : null;

  const lowVolume = row.volume <= percentile(table.map((r) => r.volume), 0.25);
  const medTd = percentile(tds, 0.5);

  const reasoning: string[] = [];
  const caveats = [...CAVEATS];
  let action: RetryAdvice["action"];
  let retryAfterHours: { min: number; max: number };
  let maxAttempts: number;
  let nudge = false;

  const tdText = `${bank} technical-decline rate is ${row.tdPct}% for AutoPay execution in ${month}, versus a median of ${round2(medTd)}% across NPCI's top-50 banks (${baseBand}).`;

  if (failureType === "technical") {
    reasoning.push("Technical declines are system-side (bank or network) and are the failure type most likely to clear on retry.");
    reasoning.push(tdText);
    const effective: TdBand = chronic && (baseBand === "low" || baseBand === "moderate") ? "elevated" : baseBand;
    if (chronic) {
      reasoning.push(`This bank's technical-decline rate was above the table's 75th percentile in ${history.filter(Boolean).length} of ${history.length} months checked.`);
      nudge = true;
    }
    if (effective === "low" || effective === "moderate") {
      action = "retry_soon";
      retryAfterHours = { min: 1, max: 3 };
      maxAttempts = 3;
    } else if (effective === "elevated") {
      action = "retry_later";
      retryAfterHours = { min: 6, max: 12 };
      maxAttempts = 3;
      reasoning.push("Elevated technical declines suggest retrying immediately may hit the same problem, so space attempts out.");
    } else {
      action = "retry_later";
      retryAfterHours = { min: 12, max: 24 };
      maxAttempts = 2;
      nudge = true;
      reasoning.push("This bank is in the worst decile for technical declines: retry sparingly and consider asking the customer for another payment method.");
    }
  } else if (failureType === "business") {
    action = "hold_and_notify_customer";
    retryAfterHours = { min: 24, max: 72 };
    maxAttempts = 2;
    reasoning.push("NPCI defines business declines as customer-side reasons (wrong PIN, limits, and similar), so a quick retry rarely changes the outcome.");
    reasoning.push("Give the customer time to act, and tell them, before trying again.");
    if (row.bdPct > percentile(bds, 0.9)) {
      nudge = true;
      reasoning.push(`${bank} has an unusually high business-decline rate (${row.bdPct}%, above the table's 90th percentile of ${round2(percentile(bds, 0.9))}%) for AutoPay execution.`);
    }
    caveats.push("Across all banks most AutoPay execution declines are business declines, so a high rate alone is not specific to this bank.");
  } else {
    action = "retry_later";
    retryAfterHours = { min: 12, max: 24 };
    maxAttempts = 2;
    reasoning.push("The failure type is unknown, so this uses a conservative middle path.");
    reasoning.push(tdText);
    caveats.push("Classify the gateway error code as technical or business first; the advice is much more useful with that.");
  }

  if (lowVolume) caveats.push("This bank is in the lowest quartile by volume in the table, so its rates come from a small sample and are noisy.");
  if (chronic === null) caveats.push("Only one month was checked, so chronic unreliability could not be assessed. Pass lookback_months > 1.");
  caveats.push("NPCI does not state the unit of AutoPay volume in its table.");

  return {
    bank,
    month,
    failureType,
    action,
    retryAfterHours,
    maxAttempts,
    nudgeCustomer: nudge,
    bankProfile: {
      executionApprovedPct: row.approvedPct,
      bdPct: row.bdPct,
      tdPct: row.tdPct,
      tdBand: baseBand,
      tableMedianTdPct: round2(medTd),
      tableP75TdPct: round2(percentile(tds, 0.75)),
      tableP90TdPct: round2(percentile(tds, 0.9)),
      tableMedianApprovedPct: round2(percentile(approved, 0.5)),
      lowVolume,
      monthsChecked: history.length,
      chronicallyElevatedTd: chronic,
    },
    reasoning,
    caveats,
  };
}

export function insufficientData(bank: string, month: string, failureType: FailureType): RetryAdvice {
  return {
    bank,
    month,
    failureType,
    action: "insufficient_data",
    nudgeCustomer: false,
    reasoning: [
      `"${bank}" is not in NPCI's AutoPay top-50 remitter table for ${month}, so there is no bank-level signal to adjust the default policy.`,
    ],
    caveats: [...CAVEATS, "Fall back to your standard retry policy keyed on the gateway error code."],
  };
}

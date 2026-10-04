export type BankSide = "remitter" | "beneficiary";

export interface BankStats {
  bank: string;
  month: string;
  side: BankSide;
  rank: number;
  volumeMn: number;
  approvedPct: number;
  /** Business declines: customer-side reasons such as wrong PIN or limits. */
  bdPct: number;
  /** Technical declines: bank or NPCI system problems. */
  tdPct: number;
  /** Remitter table only. */
  debitReversalCountMn?: number;
  debitReversalSuccessPct?: number;
  udirAutoUpdateSrPct?: number;
  udirRefundSrPct?: number;
  /** Beneficiary table only. */
  deemedApprovedPct?: number;
}

export interface UptimeRecord {
  month: string;
  uptimePct: number;
  unscheduledDowntimeMins: number;
  incidents: number;
}

export type TrendMetric = "approvedPct" | "bdPct" | "tdPct" | "volumeMn" | "debitReversalSuccessPct";

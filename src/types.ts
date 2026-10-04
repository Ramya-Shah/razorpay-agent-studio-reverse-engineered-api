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

export type AutopayKind = "execution" | "registration";

/** One row of NPCI's AutoPay top-50 remitter-bank tables. NPCI does not state the unit of `volume`. */
export interface AutopayStats {
  bank: string;
  month: string;
  kind: AutopayKind;
  rank: number;
  volume: number;
  approvedPct: number;
  bdPct: number;
  tdPct: number;
}

export type FailureType = "technical" | "business" | "unknown";
export type TdBand = "low" | "moderate" | "elevated" | "high";

export interface RetryAdvice {
  bank: string;
  month: string;
  failureType: FailureType;
  action: "retry_soon" | "retry_later" | "hold_and_notify_customer" | "insufficient_data";
  retryAfterHours?: { min: number; max: number };
  maxAttempts?: number;
  nudgeCustomer: boolean;
  bankProfile?: {
    executionApprovedPct: number;
    bdPct: number;
    tdPct: number;
    tdBand: TdBand;
    tableMedianTdPct: number;
    tableP75TdPct: number;
    tableP90TdPct: number;
    tableMedianApprovedPct: number;
    lowVolume: boolean;
    monthsChecked: number;
    chronicallyElevatedTd: boolean | null;
  };
  reasoning: string[];
  caveats: string[];
}

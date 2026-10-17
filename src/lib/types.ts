// Типи рядків бази даних (numeric приходить з PostgREST як number або string —
// для відображення використовується lib/money: fromDb/format*).

export type Num = number | string;

export type AppRole = "resident" | "admin";
export type PeriodStatus = "scheduled" | "open" | "closed";
export type PaymentStatus = "awaiting_payment" | "pending_review" | "paid" | "rejected";
export type ReconciliationStatus = "calculated" | "reviewed" | "adjustment_applied" | "closed";
export type DepositTxType = "contribution" | "discrepancy_adjustment" | "correction" | "refund";
export type RegistrationStatus = "not_registered" | "registered" | "additional_allowed";

export type Profile = {
  id: string;
  auth_user_id: string;
  apartment_id: string | null;
  surname: string;
  role: AppRole;
  is_primary: boolean;
  is_active: boolean;
};

export type Apartment = {
  id: string;
  apartment_number: string;
  resident_surname: string;
  is_active: boolean;
  registration_status: RegistrationStatus;
};

export type BillingPeriod = {
  id: string;
  year: number;
  month: number;
  start_date: string;
  end_date: string;
  reading_window_start: string;
  reading_window_end: string;
  status: PeriodStatus;
  allow_admin_edit_after_close: boolean;
  closed_at: string | null;
};

export type Tariff = {
  id: string;
  rate_per_kwh: Num;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
};

export type MeterReading = {
  id: string;
  apartment_id: string;
  billing_period_id: string;
  previous_reading: Num;
  current_reading: Num;
  consumption_kwh: Num;
  tariff_rate: Num;
  electricity_amount: Num;
  is_anomaly: boolean;
  entry_source: "resident" | "admin";
  submitted_at: string;
  updated_at: string;
  notes: string | null;
};

export type Payment = {
  id: string;
  apartment_id: string;
  billing_period_id: string;
  electricity_amount: Num;
  deposit_contribution: Num;
  hall_lighting_amount: Num;
  other_amount: Num;
  total_amount: Num;
  status: PaymentStatus;
  attempt_no: number;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  confirmed_without_receipt: boolean;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

export type Receipt = {
  id: string;
  payment_id: string;
  attempt_no: number;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

export type PaymentEvent = {
  id: string;
  event_type: "created" | "amounts_updated" | "submitted" | "receipt_added" | "approved" | "rejected";
  status_after: PaymentStatus;
  attempt_no: number;
  reason: string | null;
  created_at: string;
};

export type AppSettings = {
  envelope_url: string | null;
  max_receipt_size_mb: number;
  allowed_receipt_mime_types: string[];
  show_deposit_balance_to_residents: boolean;
  other_charges_enabled: boolean;
  max_contribution_amount: Num;
  registration_open: boolean;
  registration_code_required: boolean;
  registration_code_max_attempts: number;
  registration_lockout_minutes: number;
  default_window_start_day: number;
  default_window_start_hour: number;
  default_window_end_day: number;
  default_window_end_hour: number;
  window_for_previous_month: boolean;
  admin_edit_after_close: boolean;
  anomaly_threshold_kwh: Num | null;
  anomaly_multiplier: Num | null;
  deposit_public_note: string | null;
  updated_at: string;
};

export type PeriodTableRow = {
  apartment_id: string;
  apartment_number: string;
  resident_surname: string;
  has_reading: boolean;
  previous_reading: Num | null;
  current_reading: Num | null;
  consumption_kwh: Num | null;
  tariff_rate: Num | null;
  electricity_amount: Num | null;
  deposit_contribution: Num | null;
  hall_lighting_amount: Num | null;
  other_amount: Num | null;
  total_amount: Num | null;
  payment_id: string | null;
  payment_status: PaymentStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  receipt_count: number;
  is_own: boolean;
};

export type DepositLedgerEntry = {
  id: string;
  billing_period_id: string;
  apartment_id: string | null;
  transaction_type: DepositTxType;
  amount: Num;
  description: string;
  related_reconciliation_id: string | null;
  related_payment_id: string | null;
  created_by: string;
  created_at: string;
};

export type Reconciliation = {
  id: string;
  billing_period_id: string;
  common_consumption_kwh: Num;
  apartment_consumption_kwh: Num;
  discrepancy_kwh: Num;
  tariff_rate: Num | null;
  discrepancy_amount: Num | null;
  readings_count: number;
  active_apartments_count: number;
  is_preliminary: boolean;
  status: ReconciliationStatus;
  explanation: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

export type CommonReading = {
  id: string;
  billing_period_id: string;
  previous_reading: Num;
  current_reading: Num;
  consumption_kwh: Num;
  submitted_at: string;
  updated_at: string;
  notes: string | null;
};

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string; warnings?: string[] }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; needsConfirmation?: boolean };

export const DEPOSIT_TX_LABEL: Record<DepositTxType, string> = {
  contribution: "Внесок",
  discrepancy_adjustment: "Покриття розбіжності",
  correction: "Коригування",
  refund: "Повернення",
};

export const RECONCILIATION_STATUS_LABEL: Record<ReconciliationStatus, string> = {
  calculated: "Розраховано",
  reviewed: "Перевірено",
  adjustment_applied: "Використано депозит",
  closed: "Закрито",
};

export type HouseReport = {
  period: { label: string };
  generated_at: string;
  common_consumption_kwh: number | null;
  apartment_consumption_kwh: number;
  apartments_with_readings: number;
  apartments_without_readings: number;
  active_apartments: number;
  discrepancy_kwh: number | null;
  discrepancy_abs_kwh: number | null;
  tariff_rate: number | null;
  discrepancy_amount: number | null;
  is_preliminary: boolean;
  reconciliation: Reconciliation | null;
  charges: { electricity: number; deposit: number; hall_lighting: number; other: number };
  payments: {
    paid_count: number; paid_total: number; pending_count: number; pending_total: number;
    awaiting_count: number; awaiting_total: number; rejected_count: number; rejected_total: number;
  };
  deposit: {
    opening_balance: number; contributions: number; discrepancy_usage: number; corrections: number;
    refunds: number; closing_balance: number; current_balance: number;
  };
  charges_total?: number;
  pending_review_all?: number;
};

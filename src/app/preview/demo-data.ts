// Вигадані демонстраційні дані лише для попереднього перегляду інтерфейсу.
import type { BillingPeriod, HouseReport, MeterReading, Payment, PeriodTableRow } from "@/lib/types";

const now = Date.now();
const day = 86_400_000;

export const demoPeriod: BillingPeriod = {
  id: "00000000-0000-4000-8000-000000000001",
  year: 2026,
  month: 9,
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  reading_window_start: new Date(now - 2 * day).toISOString(),
  reading_window_end: new Date(now + 3 * day).toISOString(),
  status: "open",
  allow_admin_edit_after_close: true,
  closed_at: null,
};

export const demoApartment = { apartment_number: "12", resident_surname: "Приклад" };

export const demoReading: MeterReading = {
  id: "r1",
  apartment_id: "a12",
  billing_period_id: demoPeriod.id,
  previous_reading: "12345.67",
  current_reading: "12478.12",
  consumption_kwh: "132.45",
  tariff_rate: "4.3200",
  electricity_amount: "572.18",
  is_anomaly: false,
  entry_source: "resident",
  submitted_at: new Date(now - day).toISOString(),
  updated_at: new Date(now - day).toISOString(),
  notes: null,
};

export const demoPayment: Payment = {
  id: "p1",
  apartment_id: "a12",
  billing_period_id: demoPeriod.id,
  electricity_amount: "572.18",
  deposit_contribution: "50.00",
  hall_lighting_amount: "15.50",
  other_amount: "0.00",
  total_amount: "637.68",
  status: "awaiting_payment",
  attempt_no: 0,
  submitted_at: null,
  reviewed_at: null,
  reviewed_by: null,
  rejection_reason: null,
  confirmed_without_receipt: false,
  admin_note: null,
  created_at: new Date(now - day).toISOString(),
  updated_at: new Date(now - day).toISOString(),
};

const surnames = ["Демо-Альфа", "Демо-Бета", "Демо-Гамма", "Демо-Дельта", "Демо-Епсилон", "Демо-Зета", "Демо-Ета", "Демо-Тета", "Демо-Йота", "Демо-Каппа", "Демо-Лямбда"];
const statuses: PeriodTableRow["payment_status"][] = ["paid", "pending_review", "awaiting_payment", "paid", "rejected", "awaiting_payment", "paid", "pending_review", "awaiting_payment", "paid", "awaiting_payment"];

function money(n: number) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export const demoTable: PeriodTableRow[] = Array.from({ length: 12 }, (_, i) => {
  const num = String(i + 1);
  if (num === "12") {
    return {
      apartment_id: "a12", apartment_number: "12", resident_surname: "Приклад", has_reading: true,
      previous_reading: "12345.67", current_reading: "12478.12", consumption_kwh: "132.45", tariff_rate: "4.3200",
      electricity_amount: "572.18", deposit_contribution: "50.00", hall_lighting_amount: "15.50", other_amount: "0.00",
      total_amount: "637.68", payment_id: "p1", payment_status: "awaiting_payment", submitted_at: null, reviewed_at: null,
      receipt_count: 0, is_own: true,
    };
  }
  const missing = i === 5 || i === 8;
  const prev = 4000 + i * 731;
  const cons = 80 + ((i * 37) % 140);
  const el = cons * 4.32;
  const dep = [0, 50, 100, 30][i % 4]!;
  const hall = [10, 15, 20][i % 3]!;
  return {
    apartment_id: `a${num}`, apartment_number: num, resident_surname: surnames[i]!, has_reading: !missing,
    previous_reading: missing ? null : money(prev), current_reading: missing ? null : money(prev + cons),
    consumption_kwh: missing ? null : money(cons), tariff_rate: missing ? null : "4.3200",
    electricity_amount: missing ? null : money(el), deposit_contribution: missing ? null : money(dep),
    hall_lighting_amount: missing ? null : money(hall), other_amount: missing ? null : "0.00",
    total_amount: missing ? null : money(el + dep + hall), payment_id: missing ? null : `p${num}`,
    payment_status: missing ? "awaiting_payment" : statuses[i]!,
    submitted_at: missing ? null : new Date(now - day * (i % 3)).toISOString(),
    reviewed_at: statuses[i] === "paid" ? new Date(now - day / 2).toISOString() : null,
    receipt_count: statuses[i] === "awaiting_payment" ? 0 : 1, is_own: false,
  };
});

export const demoReport: HouseReport = {
  period: { label: "Вересень 2026" },
  generated_at: new Date().toISOString(),
  common_consumption_kwh: 1672,
  apartment_consumption_kwh: 1583.45,
  apartments_with_readings: 10,
  apartments_without_readings: 2,
  active_apartments: 12,
  discrepancy_kwh: 88.55,
  discrepancy_abs_kwh: 88.55,
  tariff_rate: 4.32,
  discrepancy_amount: 382.54,
  is_preliminary: true,
  reconciliation: null,
  charges: { electricity: 6840.5, deposit: 460, hall_lighting: 145.5, other: 0 },
  payments: { paid_count: 4, paid_total: 2310.4, pending_count: 2, pending_total: 1204.1, awaiting_count: 3, awaiting_total: 1512.3, rejected_count: 1, rejected_total: 419.2 },
  deposit: { opening_balance: 1250, contributions: 230, discrepancy_usage: 0, corrections: 0, refunds: 0, closing_balance: 1480, current_balance: 1480 },
  charges_total: 7446,
  pending_review_all: 2,
};

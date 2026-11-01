import "server-only";
import { createClient } from "@/lib/supabase/server";
import { signedReceipts, type ReceiptView } from "@/lib/receipts";
import type { MeterReading, Payment, PaymentEvent, Receipt } from "@/lib/types";

export type ApartmentPeriodState = {
  reading: MeterReading | null;
  charges: { deposit: string; hallLighting: string; other: string } | null;
  payment: Payment | null;
  receipts: ReceiptView[];
  events: PaymentEvent[];
  previous: { value: string | null; source: "reading" | "initial" | null; recordedAt: string | null; label: string | null };
  /** Перше подання квартири: до цього місяця немає ні показників, ні початкового показника */
  isFirstEntry: boolean;
  tariff: string | null;
};

/** Стан квартири за період: показник, внески, платіж, квитанції, попередній показник. */
export async function getApartmentPeriodState(apartmentId: string, periodId: string): Promise<ApartmentPeriodState> {
  const supabase = await createClient();
  const [readingRes, chargesRes, paymentRes, prevRes, tariffRes] = await Promise.all([
    supabase.from("meter_readings").select("*").eq("apartment_id", apartmentId).eq("billing_period_id", periodId).maybeSingle<MeterReading>(),
    supabase.from("additional_charges").select("charge_type, amount").eq("apartment_id", apartmentId).eq("billing_period_id", periodId),
    supabase.from("payments").select("*").eq("apartment_id", apartmentId).eq("billing_period_id", periodId).maybeSingle<Payment>(),
    supabase.rpc("get_previous_reading", { p_apartment_id: apartmentId, p_period_id: periodId }),
    supabase.rpc("get_applicable_tariff", { p_period_id: periodId }),
  ]);

  const chargeRows = (chargesRes.data ?? []) as { charge_type: string; amount: number | string }[];
  const charges = chargeRows.length
    ? {
        deposit: String(chargeRows.find((c) => c.charge_type === "deposit_contribution")?.amount ?? "0"),
        hallLighting: String(chargeRows.find((c) => c.charge_type === "hall_lighting")?.amount ?? "0"),
        other: String(chargeRows.find((c) => c.charge_type === "other")?.amount ?? "0"),
      }
    : null;

  const payment = paymentRes.data ?? null;
  let receipts: ReceiptView[] = [];
  let events: PaymentEvent[] = [];
  if (payment) {
    const [{ data: r }, { data: e }] = await Promise.all([
      supabase.from("receipts").select("*").eq("payment_id", payment.id).order("created_at", { ascending: false }),
      supabase.from("payment_events").select("id, event_type, status_after, attempt_no, reason, created_at").eq("payment_id", payment.id).order("created_at"),
    ]);
    receipts = await signedReceipts(supabase, (r ?? []) as Receipt[]);
    events = (e ?? []) as PaymentEvent[];
  }

  const prevRow = (Array.isArray(prevRes.data) ? prevRes.data[0] : null) as
    | { previous_reading: number | string; source: "reading" | "initial"; recorded_at: string | null; source_label: string | null }
    | null;

  return {
    reading: readingRes.data ?? null,
    charges,
    payment,
    receipts,
    events,
    previous: {
      value: readingRes.data ? String(readingRes.data.previous_reading) : prevRow ? String(prevRow.previous_reading) : null,
      source: readingRes.data ? "reading" : (prevRow?.source ?? null),
      recordedAt: prevRow?.recorded_at ?? null,
      label: prevRow?.source_label ?? null,
    },
    isFirstEntry: !prevRow,
    tariff: readingRes.data ? String(readingRes.data.tariff_rate) : tariffRes.data != null ? String(tariffRes.data) : null,
  };
}

export type UnpaidPayment = {
  periodId: string;
  year: number;
  month: number;
  total: string;
  status: "awaiting_payment" | "rejected";
};

/**
 * Неоплачені нарахування квартири за всі місяці (новіші першими).
 * Оплата не обмежена вікном приймання показників: оплатити можна будь-коли.
 */
export async function getUnpaidPayments(apartmentId: string): Promise<UnpaidPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("billing_period_id, total_amount, status, billing_periods(year, month)")
    .eq("apartment_id", apartmentId)
    .in("status", ["awaiting_payment", "rejected"])
    .gt("total_amount", 0);
  if (error) {
    console.error("getUnpaidPayments:", error.code, error.message);
    return [];
  }
  type Row = { billing_period_id: string; total_amount: number | string; status: UnpaidPayment["status"]; billing_periods: { year: number; month: number } | null };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.billing_periods)
    .map((r) => ({ periodId: r.billing_period_id, year: r.billing_periods!.year, month: r.billing_periods!.month, total: String(r.total_amount), status: r.status }))
    .sort((a, b) => b.year - a.year || b.month - a.month);
}

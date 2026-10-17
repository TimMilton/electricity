import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AppSettings, BillingPeriod, PeriodTableRow, Tariff } from "@/lib/types";

export const getSettings = cache(async (): Promise<AppSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("app_settings").select("*").single<AppSettings>();
  if (error || !data) throw new Error("Не вдалося завантажити налаштування");
  return data;
});

export const getCurrentPeriod = cache(async (): Promise<BillingPeriod | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_current_period");
  const p = data as BillingPeriod | null;
  return p && p.id ? p : null;
});

export const listPeriods = cache(async (): Promise<BillingPeriod[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("billing_periods")
    .select("*")
    .order("year", { ascending: false })
    .order("month", { ascending: false });
  return (data ?? []) as BillingPeriod[];
});

/** Обраний період із параметра ?period=, інакше — поточний. */
export async function resolvePeriod(periodParam: string | string[] | undefined): Promise<{
  period: BillingPeriod | null;
  periods: BillingPeriod[];
}> {
  const periods = await listPeriods();
  const id = typeof periodParam === "string" ? periodParam : undefined;
  const fromParam = id ? periods.find((p) => p.id === id) : undefined;
  if (fromParam) return { period: fromParam, periods };
  const current = await getCurrentPeriod();
  return { period: current ? (periods.find((p) => p.id === current.id) ?? current) : (periods[0] ?? null), periods };
}

export const getPeriodTable = cache(async (periodId: string): Promise<PeriodTableRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_period_table", { p_period_id: periodId });
  if (error) throw new Error("Не вдалося завантажити таблицю");
  return (data ?? []) as PeriodTableRow[];
});

export const listTariffs = cache(async (): Promise<Tariff[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("tariffs").select("*").order("valid_from", { ascending: false });
  return (data ?? []) as Tariff[];
});

export async function getTariffForPeriod(periodId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_applicable_tariff", { p_period_id: periodId });
  return data === null || data === undefined ? null : String(data);
}

export { periodPhase, type PeriodPhase } from "@/lib/period";

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDb, toDecimalString } from "@/lib/money";

/** Нараховані внески «Освітлення під'їзду» за періодами (сума за всіма квартирами). */
export async function getHallLightingByPeriod(supabase: SupabaseClient, periodIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (periodIds.length === 0) return result;
  const { data, error } = await supabase
    .from("additional_charges")
    .select("billing_period_id, amount")
    .eq("charge_type", "hall_lighting")
    .in("billing_period_id", periodIds);
  if (error) {
    console.error("getHallLightingByPeriod:", error.code, error.message);
    return result;
  }
  const sums = new Map<string, bigint>();
  for (const r of (data ?? []) as { billing_period_id: string; amount: number | string }[]) {
    sums.set(r.billing_period_id, (sums.get(r.billing_period_id) ?? 0n) + (fromDb(r.amount, 2) ?? 0n));
  }
  for (const [k, v] of sums) result.set(k, toDecimalString(v, 2));
  return result;
}

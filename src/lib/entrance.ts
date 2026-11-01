import type { SupabaseClient } from "@supabase/supabase-js";

export type EntranceFilterValue = "" | "1" | "2" | "3" | "none";

export function parseEntranceFilter(v: string | string[] | undefined): EntranceFilterValue {
  return v === "1" || v === "2" || v === "3" || v === "none" ? v : "";
}

export function matchesEntrance(entrance: number | null | undefined, filter: EntranceFilterValue): boolean {
  if (!filter) return true;
  if (filter === "none") return entrance == null;
  return String(entrance) === filter;
}

/**
 * Під'їзди всіх квартир. Якщо міграцію з під'їздом ще не застосовано (немає стовпчика),
 * повертає порожню карту — сторінки працюють, просто без під'їздів.
 */
export async function getEntranceMap(supabase: SupabaseClient): Promise<Map<string, number | null>> {
  const { data, error } = await supabase.from("apartments").select("id, entrance");
  if (error) {
    console.error("getEntranceMap:", error.code, error.message);
    return new Map();
  }
  return new Map(((data ?? []) as { id: string; entrance: number | null }[]).map((a) => [a.id, a.entrance]));
}

import type { BillingPeriod } from "@/lib/types";

export type PeriodPhase = "before" | "open" | "after" | "closed";

export function periodPhase(p: BillingPeriod, now = new Date()): PeriodPhase {
  if (p.status === "closed") return "closed";
  if (now < new Date(p.reading_window_start)) return "before";
  if (now >= new Date(p.reading_window_end)) return "after";
  return "open";
}

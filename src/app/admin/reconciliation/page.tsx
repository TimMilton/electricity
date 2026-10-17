import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui/controls";
import { ReconciliationCard } from "@/components/admin/reconciliation-card";
import type { Reconciliation } from "@/lib/types";

export const metadata: Metadata = { title: "Розбіжності" };

export default async function ReconciliationPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data }, { data: dep }] = await Promise.all([
    supabase.from("reconciliation_records").select("*, billing_periods(year, month)").order("created_at", { ascending: false }),
    supabase.rpc("get_deposit_summary"),
  ]);
  const rows = (data ?? []) as (Reconciliation & { billing_periods: { year: number; month: number } })[];
  rows.sort((a, b) => b.billing_periods.year * 12 + b.billing_periods.month - (a.billing_periods.year * 12 + a.billing_periods.month));
  const balance = String((dep as { balance: number } | null)?.balance ?? 0);
  return (
    <>
      <PageHeader
        title="Розбіжності"
        description="Різниця між загальним лічильником і сумою квартирних. Депозит ніколи не списується автоматично — лише вашим рішенням після перевірки."
      />
      {rows.length === 0 ? (
        <EmptyState title="Розбіжностей ще не розраховано">Внесіть показник загального лічильника за місяць.</EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {rows.map((r) => (
            <ReconciliationCard key={r.id} rec={r} periodId={r.billing_period_id} balance={balance} withPeriodTitle={r.billing_periods} />
          ))}
        </div>
      )}
    </>
  );
}

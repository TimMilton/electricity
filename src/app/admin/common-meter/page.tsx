import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { resolvePeriod } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { formatKwh, formatReading } from "@/lib/money";
import { EmptyState, PageHeader, Panel, Row } from "@/components/ui/controls";
import { PeriodPicker } from "@/components/period-picker";
import { CommonReadingForm } from "@/components/admin/finance";
import { ReconciliationCard } from "@/components/admin/reconciliation-card";
import type { CommonReading, Reconciliation } from "@/lib/types";

export const metadata: Metadata = { title: "Загальний лічильник" };

export default async function CommonMeterPage({ searchParams }: PageProps<"/admin/common-meter">) {
  await requireAdmin();
  const sp = await searchParams;
  const { period, periods } = await resolvePeriod(sp.period);
  if (!period) return (<><PageHeader title="Загальний лічильник" /><EmptyState title="Періодів ще немає" /></>);
  const supabase = await createClient();
  const [{ data: common }, { data: prev }, { data: rec }, { data: history }, { data: balance }] = await Promise.all([
    supabase.from("common_meter_readings").select("*").eq("billing_period_id", period.id).maybeSingle<CommonReading>(),
    supabase.rpc("get_previous_common_reading", { p_period_id: period.id }),
    supabase.from("reconciliation_records").select("*").eq("billing_period_id", period.id).maybeSingle<Reconciliation>(),
    supabase.from("common_meter_readings").select("*, billing_periods(year, month)").order("submitted_at", { ascending: false }).limit(24),
    supabase.rpc("get_deposit_summary"),
  ]);
  const locked = rec?.status === "adjustment_applied" || rec?.status === "closed";

  return (
    <>
      <PageHeader title="Загальний лічильник" description="Показники лічильника будинку, за яким фактично сплачується електроенергія." />
      <div className="mb-4"><PeriodPicker periods={periods} selectedId={period.id} /></div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`Показник за ${periodLabel(period).toLowerCase()}`} description={common ? `Внесено ${formatDateTime(common.updated_at)}` : undefined}>
          {locked ? (
            <dl>
              <Row label="Попередній" value={formatReading(common?.previous_reading)} />
              <Row label="Поточний" value={formatReading(common?.current_reading)} />
              <Row label="Споживання" value={formatKwh(common?.consumption_kwh)} strong />
              <p className="mt-3 text-sm text-ink-soft">Розбіжність за місяць закрито або використано депозит — показник змінити не можна.</p>
            </dl>
          ) : (
            <CommonReadingForm
              periodId={period.id}
              existing={common ? { previous: String(common.previous_reading), current: String(common.current_reading), notes: common.notes } : null}
              suggestedPrevious={prev != null ? String(prev) : null}
            />
          )}
        </Panel>
        {rec ? (
          <ReconciliationCard rec={rec} periodId={period.id} balance={String((balance as { balance: number } | null)?.balance ?? 0)} />
        ) : (
          <Panel title="Розбіжність">
            <p className="text-ink-soft">Розрахунок з&apos;явиться після збереження показника загального лічильника.</p>
          </Panel>
        )}
      </div>
      <Panel title="Історія показників" className="mt-5">
        <ul className="divide-y divide-line">
          {((history ?? []) as (CommonReading & { billing_periods: { year: number; month: number } })[]).map((h) => (
            <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2 text-[15px]">
              <Link href={`/admin/common-meter?period=${h.billing_period_id}`} className="text-face underline underline-offset-4">{periodLabel(h.billing_periods)}</Link>
              <span className="tabular">{formatReading(h.previous_reading)} → {formatReading(h.current_reading)}, {formatKwh(h.consumption_kwh)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

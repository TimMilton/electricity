import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSettings, resolvePeriod } from "@/lib/data";
import { getHouseReceiptViews } from "@/lib/house-receipts";
import { getHallLightingByPeriod } from "@/lib/hall-lighting";
import { HouseReceiptUploader } from "@/components/admin/house-receipt-uploader";
import { ReceiptList } from "@/components/receipt-list";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { formatKwh, formatReading, fromDb, toDecimalString } from "@/lib/money";
import { EmptyState, Notice, PageHeader, Panel } from "@/components/ui/controls";
import { PeriodPicker } from "@/components/period-picker";
import { CommonReadingForm, DeleteCommonReadingButton } from "@/components/admin/finance";
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
    supabase.from("common_meter_readings").select("*"),
    supabase.rpc("get_deposit_summary"),
  ]);
  const [houseReceipts, settings, hall] = await Promise.all([
    getHouseReceiptViews(period.id),
    getSettings(),
    getHallLightingByPeriod(supabase, [period.id]),
  ]);
  const periodClosed = period.status === "closed";
  // Скільки вже використано з депозиту на розбіжність цього місяця
  let depositUsed: string | null = null;
  if (rec) {
    const { data: ledger } = await supabase.from("deposit_ledger").select("amount").eq("related_reconciliation_id", rec.id);
    const used = ((ledger ?? []) as { amount: number | string }[]).reduce((sum, l) => sum - (fromDb(l.amount, 2) ?? 0n), 0n);
    depositUsed = used > 0n ? toDecimalString(used, 2) : null;
  }

  // Усі місяці (від нових до старих) з показником, якщо його внесено
  const readings = new Map(((history ?? []) as CommonReading[]).map((h) => [h.billing_period_id, h]));
  const ordered = [...periods].sort((a, b) => b.year - a.year || b.month - a.month);
  // Найближчий наступний місяць із показником — його початкове значення можна узгодити
  const nextPeriod = [...ordered]
    .reverse()
    .find((p) => (p.year > period.year || (p.year === period.year && p.month > period.month)) && readings.has(p.id));
  const nextReading = nextPeriod ? readings.get(nextPeriod.id) : undefined;

  return (
    <>
      <PageHeader title="Загальний лічильник" description="Показники лічильника будинку, за яким фактично сплачується електроенергія." />
      <div className="mb-4"><PeriodPicker periods={periods} selectedId={period.id} /></div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title={`Показник за ${periodLabel(period).toLowerCase()}`}
          description={common ? `Внесено ${formatDateTime(common.updated_at)}. Можна виправити або видалити — з причиною для журналу змін.` : undefined}
        >
          <CommonReadingForm
            key={`${period.id}-${common?.updated_at ?? "new"}`}
            periodId={period.id}
            existing={common ? { previous: String(common.previous_reading), current: String(common.current_reading), notes: common.notes } : null}
            suggestedPrevious={prev != null ? String(prev) : null}
            depositUsed={depositUsed}
            next={nextPeriod && nextReading ? { label: periodLabel(nextPeriod), previous: String(nextReading.previous_reading) } : null}
          />
          {common && (
            <div className="mt-5 border-t border-line pt-4">
              <DeleteCommonReadingButton periodId={period.id} periodLabel={periodLabel(period)} depositUsed={depositUsed} />
            </div>
          )}
        </Panel>
        {rec ? (
          <ReconciliationCard
            rec={rec}
            periodId={period.id}
            balance={String((balance as { balance: number } | null)?.balance ?? 0)}
            hallLighting={hall.get(period.id) ?? "0.00"}
          />
        ) : (
          <Panel title="Розбіжність">
            <p className="text-ink-soft">Розрахунок з&apos;явиться після збереження показника загального лічильника.</p>
          </Panel>
        )}
      </div>
      <Panel
        title={`Квитанція про оплату за загальним лічильником: ${periodLabel(period).toLowerCase()}`}
        description="Квитанція або скріншот оплати постачальнику за весь будинок. Мешканці бачать її в блоці «Будинок» після закриття періоду."
        className="mt-5"
      >
        <Notice tone={periodClosed ? "ok" : "info"} className="mb-4">
          {periodClosed
            ? "Період закрито — мешканці вже бачать завантажені квитанції."
            : `Період ще не закрито: мешканці побачать квитанції після ${formatDateTime(period.reading_window_end)} (завершення приймання показників) або після того, як ви закриєте період вручну в розділі «Періоди й тарифи».`}
        </Notice>
        {houseReceipts.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {houseReceipts.map((r) => r.note && <p key={`note-${r.id}`} className="text-[15px]">{r.original_filename}: {r.note}</p>)}
            <ReceiptList receipts={houseReceipts} deletable deleteKind="house" />
          </div>
        )}
        <HouseReceiptUploader periodId={period.id} maxSizeMb={settings.max_receipt_size_mb} />
      </Panel>

      <Panel
        title="Усі місяці"
        description="Оберіть місяць, щоб внести або виправити показник. Потрібного місяця немає — створіть його в розділі «Періоди»."
        className="mt-5"
      >
        <ul className="divide-y divide-line">
          {ordered.map((p) => {
            const h = readings.get(p.id);
            const selected = p.id === period.id;
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                <Link
                  href={`/admin/common-meter?period=${p.id}`}
                  className={selected ? "font-semibold" : "text-face underline underline-offset-4"}
                  aria-current={selected ? "page" : undefined}
                >
                  {periodLabel(p)}
                </Link>
                <span className="flex items-center gap-3">
                  {h ? (
                    <span className="tabular">{formatReading(h.previous_reading)} → {formatReading(h.current_reading)}, {formatKwh(h.consumption_kwh)}</span>
                  ) : (
                    <span className="text-ink-soft">Не внесено</span>
                  )}
                  {!selected && (
                    <Link href={`/admin/common-meter?period=${p.id}`} className="text-sm text-face underline underline-offset-4">
                      {h ? "Змінити" : "Внести"}
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm">
          <Link href="/admin/periods" className="text-face underline underline-offset-4">Створити період за минулий місяць</Link>
        </p>
      </Panel>
    </>
  );
}

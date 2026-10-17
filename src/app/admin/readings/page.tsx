import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPeriodTable, resolvePeriod } from "@/lib/data";
import { formatKwh, formatMoney, formatReading } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/ui/controls";
import { PaymentStatusBadge } from "@/components/ui/status";
import { PeriodPicker } from "@/components/period-picker";
import { WindowNotice } from "@/components/charges";
import { AdminReadingEditor } from "@/components/admin/reading-editor";

export const metadata: Metadata = { title: "Показники" };

export default async function AdminReadingsPage({ searchParams }: PageProps<"/admin/readings">) {
  await requireAdmin();
  const sp = await searchParams;
  const { period, periods } = await resolvePeriod(sp.period);
  if (!period) {
    return (
      <>
        <PageHeader title="Показники" />
        <EmptyState title="Періодів ще немає" />
      </>
    );
  }
  const rows = await getPeriodTable(period.id);
  const missing = rows.filter((r) => !r.has_reading);
  const editable = period.status !== "closed" || period.allow_admin_edit_after_close;

  return (
    <>
      <PageHeader title="Показники" description={`Подали ${rows.length - missing.length} з ${rows.length}. Без показників: ${missing.map((m) => m.apartment_number).join(", ") || "немає"}.`} />
      <div className="mb-4 flex flex-col gap-3">
        <PeriodPicker periods={periods} selectedId={period.id} />
        <WindowNotice period={period} isAdmin />
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
        <table className="w-full min-w-[900px] text-[15px]">
          <thead className="bg-casing text-left text-sm text-ink-soft">
            <tr>
              <th className="px-3 py-2.5 font-medium">Кв.</th>
              <th className="px-3 py-2.5 font-medium">Прізвище</th>
              <th className="px-3 py-2.5 text-right font-medium">Попередній</th>
              <th className="px-3 py-2.5 text-right font-medium">Поточний</th>
              <th className="px-3 py-2.5 text-right font-medium">Спожито</th>
              <th className="px-3 py-2.5 text-right font-medium">Разом</th>
              <th className="px-3 py-2.5 font-medium">Статус</th>
              <th className="px-3 py-2.5 font-medium">Подано</th>
              <th className="px-3 py-2.5"><span className="sr-only">Дії</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.apartment_id} className="border-t border-line">
                <td className="px-3 py-2.5 font-semibold">{r.apartment_number}</td>
                <td className="px-3 py-2.5">{r.resident_surname}</td>
                <td className="tabular px-3 py-2.5 text-right">{r.has_reading ? formatReading(r.previous_reading) : "—"}</td>
                <td className="tabular px-3 py-2.5 text-right">{r.has_reading ? formatReading(r.current_reading) : <span className="text-warn">Не внесено</span>}</td>
                <td className="tabular px-3 py-2.5 text-right">{r.has_reading ? formatKwh(r.consumption_kwh) : "—"}</td>
                <td className="tabular px-3 py-2.5 text-right font-semibold">{r.has_reading ? formatMoney(r.total_amount) : "—"}</td>
                <td className="px-3 py-2.5">
                  {r.payment_id ? (
                    <Link href={`/admin/payments/${r.payment_id}`}><PaymentStatusBadge status={r.payment_status} /></Link>
                  ) : (
                    <PaymentStatusBadge status={r.payment_status} />
                  )}
                </td>
                <td className="px-3 py-2.5 text-sm text-ink-soft">{formatDateTime(r.submitted_at)}</td>
                <td className="px-3 py-2.5 text-right">
                  {editable && (
                    <AdminReadingEditor
                      apartmentId={r.apartment_id}
                      periodId={period.id}
                      number={r.apartment_number}
                      hasReading={r.has_reading}
                      previous={r.previous_reading}
                      current={r.current_reading}
                      deposit={r.deposit_contribution}
                      hallLighting={r.hall_lighting_amount}
                      other={r.other_amount}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

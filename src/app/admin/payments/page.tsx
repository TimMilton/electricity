import type { Metadata } from "next";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { listPeriods } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { Button, EmptyState, PageHeader, Select } from "@/components/ui/controls";
import { PaymentStatusBadge, PAYMENT_STATUS_LABEL } from "@/components/ui/status";
import type { Payment, PaymentStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Платежі" };

type Row = Payment & {
  apartments: { apartment_number: string; resident_surname: string; sort_num: number | null } | null;
  billing_periods: { year: number; month: number } | null;
  receipts: { count: number }[];
};

const STATUSES = Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[];

export default async function AdminPaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  await requireAdmin();
  const sp = await searchParams;
  const periods = await listPeriods();
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status as PaymentStatus) ? (sp.status as PaymentStatus) : undefined;
  const periodId = typeof sp.period === "string" && periods.some((p) => p.id === sp.period) ? sp.period : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const supabase = await createClient();
  let query = supabase
    .from("payments")
    .select("*, apartments(apartment_number, resident_surname, sort_num), billing_periods(year, month), receipts(count)")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (status) query = query.eq("status", status);
  if (periodId) query = query.eq("billing_period_id", periodId);
  const { data } = await query;
  let rows = (data ?? []) as Row[];
  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter(
      (r) => r.apartments?.apartment_number.toLowerCase() === ql || r.apartments?.resident_surname.toLowerCase().includes(ql),
    );
  }

  return (
    <>
      <PageHeader title="Платежі" description="Перевірка квитанцій і підтвердження оплат." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Статус
          <Select name="status" defaultValue={status ?? ""} className="w-48">
            <option value="">Усі</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{PAYMENT_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Період
          <Select name="period" defaultValue={periodId ?? ""} className="w-48">
            <option value="">Усі</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{periodLabel(p)}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Квартира або прізвище
          <input name="q" defaultValue={q} className="h-11 w-44 rounded-[var(--radius-control)] border border-line bg-surface px-3" />
        </label>
        <Button type="submit" variant="outline">Застосувати</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Платежів не знайдено">Змініть фільтри.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="w-full min-w-[760px] text-[15px]">
            <thead className="bg-casing text-left text-sm text-ink-soft">
              <tr>
                <th className="px-3 py-2.5 font-medium">Кв.</th>
                <th className="px-3 py-2.5 font-medium">Прізвище</th>
                <th className="px-3 py-2.5 font-medium">Період</th>
                <th className="px-3 py-2.5 text-right font-medium">Сума</th>
                <th className="px-3 py-2.5 font-medium">Статус</th>
                <th className="px-3 py-2.5 font-medium">Подано</th>
                <th className="px-3 py-2.5 font-medium"><span className="sr-only">Дія</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2.5 font-semibold">{r.apartments?.apartment_number}</td>
                  <td className="px-3 py-2.5">{r.apartments?.resident_surname}</td>
                  <td className="px-3 py-2.5">{r.billing_periods ? periodLabel(r.billing_periods) : "—"}</td>
                  <td className="tabular px-3 py-2.5 text-right font-semibold">{formatMoney(r.total_amount)}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <PaymentStatusBadge status={r.status} />
                      {(r.receipts?.[0]?.count ?? 0) > 0 && <Paperclip className="size-4 text-ink-soft" aria-label="Є квитанція" />}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft">{formatDateTime(r.submitted_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Button asChild size="sm" variant={r.status === "pending_review" ? "primary" : "outline"}>
                      <Link href={`/admin/payments/${r.id}`}>{r.status === "pending_review" ? "Перевірити" : "Відкрити"}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

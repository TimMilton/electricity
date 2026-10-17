import type { Metadata } from "next";
import Link from "next/link";
import { FileDown } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { listPeriods } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, fromDb } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { Button, EmptyState, PageHeader, Panel, Select } from "@/components/ui/controls";
import { Stat } from "@/components/period-picker";
import { Tag } from "@/components/ui/status";
import { DepositOperationForm } from "@/components/admin/finance";
import { DEPOSIT_TX_LABEL, type DepositLedgerEntry, type DepositTxType } from "@/lib/types";

export const metadata: Metadata = { title: "Баланс депозиту" };

type Entry = DepositLedgerEntry & {
  billing_periods: { year: number; month: number } | null;
  apartments: { apartment_number: string } | null;
};

const TYPES = Object.keys(DEPOSIT_TX_LABEL) as DepositTxType[];

export default async function DepositPage({ searchParams }: PageProps<"/admin/deposit">) {
  await requireAdmin();
  const sp = await searchParams;
  const periods = await listPeriods();
  const periodId = typeof sp.period === "string" && periods.some((p) => p.id === sp.period) ? sp.period : undefined;
  const type = typeof sp.type === "string" && TYPES.includes(sp.type as DepositTxType) ? (sp.type as DepositTxType) : undefined;

  const supabase = await createClient();
  const [{ data: all }, { data: apts }] = await Promise.all([
    supabase.from("deposit_ledger").select("*, billing_periods(year, month), apartments(apartment_number)").order("created_at", { ascending: false }),
    supabase.from("apartments").select("id, apartment_number, sort_num").eq("is_active", true).order("sort_num"),
  ]);
  const entries = (all ?? []) as Entry[];
  const sumOf = (t?: DepositTxType) => entries.filter((e) => !t || e.transaction_type === t).reduce((s, e) => s + (fromDb(e.amount, 2) ?? 0n), 0n);
  const filtered = entries.filter((e) => (!periodId || e.billing_period_id === periodId) && (!type || e.transaction_type === type));

  return (
    <>
      <PageHeader
        title="Баланс депозиту"
        description="Незмінний журнал руху коштів. Внески потрапляють сюди лише після підтвердження платежу."
        actions={
          <Button asChild variant="outline">
            <a href={`/api/export/deposit${periodId ? `?period=${periodId}` : ""}`}>
              <FileDown aria-hidden />
              Експорт CSV
            </a>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Поточний баланс" value={formatMoney(sumOf())} tone="signal" />
        <Stat label="Усього внесків" value={formatMoney(sumOf("contribution"))} tone="ok" />
        <Stat label="Покриття розбіжностей" value={formatMoney(sumOf("discrepancy_adjustment"))} />
        <Stat label="Коригування й повернення" value={formatMoney(sumOf("correction") + sumOf("refund"))} />
      </div>

      <Panel title="Журнал операцій" className="mt-5">
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
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
            Тип
            <Select name="type" defaultValue={type ?? ""} className="w-48">
              <option value="">Усі</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>{DEPOSIT_TX_LABEL[t]}</option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="outline">Застосувати</Button>
        </form>
        {filtered.length === 0 ? (
          <EmptyState title="Операцій не знайдено" />
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((e) => (
              <li key={e.id}>
                <details className="group py-2.5">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Tag tone={Number(e.amount) > 0 ? "ok" : "warn"}>{DEPOSIT_TX_LABEL[e.transaction_type]}</Tag>
                      <span>{e.billing_periods ? periodLabel(e.billing_periods) : ""}</span>
                      {e.apartments && <span className="text-ink-soft">кв. {e.apartments.apartment_number}</span>}
                    </span>
                    <span className={`tabular font-semibold ${Number(e.amount) > 0 ? "text-ok" : "text-danger"}`}>
                      {Number(e.amount) > 0 ? "+" : ""}
                      {formatMoney(e.amount)}
                    </span>
                  </summary>
                  <div className="mt-2 rounded-md bg-casing px-3 py-2 text-[15px]">
                    <p><span className="text-ink-soft">Підстава:</span> {e.description}</p>
                    <p><span className="text-ink-soft">Дата:</span> {formatDateTime(e.created_at)}</p>
                    {e.related_payment_id && (
                      <p><Link className="text-face underline underline-offset-4" href={`/admin/payments/${e.related_payment_id}`}>Пов&apos;язаний платіж</Link></p>
                    )}
                    {e.related_reconciliation_id && (
                      <p><Link className="text-face underline underline-offset-4" href={`/admin/common-meter?period=${e.billing_period_id}`}>Пов&apos;язана розбіжність</Link></p>
                    )}
                    <p><Link className="text-face underline underline-offset-4" href={`/admin/audit?entity=${e.id}`}>Запис у журналі змін</Link></p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Ручна операція" description="Для виправлення помилок обліку або повернення коштів. Використання на розбіжність — у розділі «Розбіжності»." className="mt-5">
        <DepositOperationForm
          periods={periods.map((p) => ({ id: p.id, label: periodLabel(p) }))}
          apartments={((apts ?? []) as { id: string; apartment_number: string }[]).map((a) => ({ id: a.id, label: `Кв. ${a.apartment_number}` }))}
          defaultPeriodId={periodId}
        />
      </Panel>
    </>
  );
}

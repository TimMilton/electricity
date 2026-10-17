"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, Search } from "lucide-react";
import { Input, Select } from "@/components/ui/controls";
import { PaymentStatusBadge, PAYMENT_STATUS_LABEL } from "@/components/ui/status";
import { ChargeDialog } from "@/components/charge-dialog";
import { fromDb, formatKwh, formatMoney, formatRate, formatReading } from "@/lib/money";
import type { PaymentStatus, PeriodTableRow } from "@/lib/types";
import { cn } from "@/lib/utils";

function sum(rows: PeriodTableRow[], key: keyof PeriodTableRow): bigint {
  return rows.reduce((acc, r) => acc + (fromDb(r[key] as string | number | null, 2) ?? 0n), 0n);
}

export function ResidentsTable({ rows, periodId, maxSizeMb }: { rows: PeriodTableRow[]; periodId: string; maxSizeMb: number }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | PaymentStatus | "no_reading">("");
  const [desc, setDesc] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (q && !r.apartment_number.toLowerCase().includes(q) && !r.resident_surname.toLowerCase().includes(q)) return false;
      if (status === "no_reading") return !r.has_reading;
      if (status && r.payment_status !== status) return false;
      return true;
    });
    const num = (s: string) => {
      const m = /^\d+/.exec(s);
      return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
    };
    list.sort((a, b) => {
      const d = num(a.apartment_number) - num(b.apartment_number) || a.apartment_number.localeCompare(b.apartment_number, "uk");
      return desc ? -d : d;
    });
    return list;
  }, [rows, query, status, desc]);

  const withReading = filtered.filter((r) => r.has_reading);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="relative flex-1">
          <span className="sr-only">Пошук за номером квартири або прізвищем</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Квартира або прізвище" className="pl-9" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:w-56">
          <span className="sr-only">Фільтр за статусом</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">Усі статуси</option>
            {(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="no_reading">Показники не внесено</option>
          </Select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
        <table className="w-full min-w-[1100px] border-collapse text-[15px]">
          <caption className="sr-only">Показники та нарахування мешканців</caption>
          <thead className="bg-casing text-left text-sm text-ink-soft">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-casing px-3 py-2.5 font-medium">
                <button type="button" onClick={() => setDesc((v) => !v)} className="inline-flex items-center gap-1 font-medium hover:text-ink">
                  Кв. <ArrowDownUp className="size-3.5" aria-hidden />
                  <span className="sr-only">{desc ? "сортування за спаданням" : "сортування за зростанням"}</span>
                </button>
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">Прізвище</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Попередній</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Поточний</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Спожито</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Тариф, грн</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Електроенергія</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Депозит</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Освітлення</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Інші</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Разом</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.apartment_id} className={cn("border-t border-line", r.is_own && "bg-signal-soft/60")}>
                <th scope="row" className={cn("sticky left-0 bg-surface px-3 py-2.5 text-left font-semibold", r.is_own && "bg-signal-soft")}>
                  {r.apartment_number}
                </th>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {r.resident_surname}
                  {r.is_own && <span className="ml-1 text-sm text-ink-soft">(ви)</span>}
                </td>
                {r.has_reading ? (
                  <>
                    <td className="tabular px-3 py-2.5 text-right">{formatReading(r.previous_reading)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatReading(r.current_reading)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatKwh(r.consumption_kwh)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatRate(r.tariff_rate)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatMoney(r.electricity_amount)}</td>
                  </>
                ) : (
                  <td colSpan={5} className="px-3 py-2.5 text-center text-ink-soft">
                    Не внесено
                  </td>
                )}
                <td className="tabular px-3 py-2.5 text-right">{r.deposit_contribution === null ? "—" : formatMoney(r.deposit_contribution)}</td>
                <td className="tabular px-3 py-2.5 text-right">{r.hall_lighting_amount === null ? "—" : formatMoney(r.hall_lighting_amount)}</td>
                <td className="tabular px-3 py-2.5 text-right">{r.other_amount === null ? "—" : formatMoney(r.other_amount)}</td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenId(r.apartment_id)}
                    className="tabular font-semibold text-face underline decoration-face/40 underline-offset-4 hover:decoration-face"
                    aria-label={`Деталі нарахування, квартира ${r.apartment_number}`}
                  >
                    {r.has_reading ? formatMoney(r.total_amount) : "Деталі"}
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <PaymentStatusBadge status={r.payment_status} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-ink-soft">
                  Нічого не знайдено. Змініть пошук або фільтр.
                </td>
              </tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="border-t-2 border-line bg-casing font-semibold">
              <tr>
                <th scope="row" className="sticky left-0 bg-casing px-3 py-2.5 text-left">
                  Разом
                </th>
                <td className="px-3 py-2.5 text-sm font-normal text-ink-soft">
                  внесли {withReading.length} з {filtered.length}
                </td>
                <td />
                <td />
                <td className="tabular px-3 py-2.5 text-right">{formatKwh(sum(withReading, "consumption_kwh"))}</td>
                <td />
                <td className="tabular px-3 py-2.5 text-right">{formatMoney(sum(withReading, "electricity_amount"))}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatMoney(sum(filtered, "deposit_contribution"))}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatMoney(sum(filtered, "hall_lighting_amount"))}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatMoney(sum(filtered, "other_amount"))}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatMoney(sum(withReading, "total_amount"))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-sm text-ink-soft md:hidden">Таблицю можна прокручувати вбік. Натисніть на суму, щоб побачити деталі.</p>

      <ChargeDialog open={openId !== null} onOpenChange={(v) => !v && setOpenId(null)} apartmentId={openId} periodId={periodId} maxSizeMb={maxSizeMb} />
    </div>
  );
}

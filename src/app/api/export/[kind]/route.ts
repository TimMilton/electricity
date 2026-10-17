import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csvResponse } from "@/lib/csv";
import { plainDecimal } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { PAYMENT_STATUS_LABEL } from "@/components/ui/status";
import { DEPOSIT_TX_LABEL, type BillingPeriod, type DepositTxType, type HouseReport, type PaymentStatus, type PeriodTableRow } from "@/lib/types";

const m = (v: unknown) => plainDecimal(v as string | number | null, 2);
const t4 = (v: unknown) => plainDecimal(v as string | number | null, 4);

export async function GET(request: NextRequest, ctx: RouteContext<"/api/export/[kind]">) {
  const session = await getSession();
  if (!session?.isAdmin) return new Response("Доступ заборонено", { status: 403 });
  const { kind } = await ctx.params;
  const periodId = request.nextUrl.searchParams.get("period");
  const supabase = await createClient();
  const generated = ["Сформовано", formatDateTime(new Date())];

  let period: BillingPeriod | null = null;
  if (periodId) {
    if (!/^[0-9a-f-]{36}$/i.test(periodId)) return new Response("Некоректний період", { status: 400 });
    const { data } = await supabase.from("billing_periods").select("*").eq("id", periodId).maybeSingle<BillingPeriod>();
    period = data;
  }
  const needPeriod = ["report", "table", "payments"].includes(kind);
  if (needPeriod && !period) return new Response("Оберіть період", { status: 400 });
  const slug = period ? `${period.year}-${String(period.month).padStart(2, "0")}` : new Date().toISOString().slice(0, 10);

  switch (kind) {
    case "table": {
      const { data, error } = await supabase.rpc("get_period_table", { p_period_id: period!.id });
      if (error) return new Response("Помилка", { status: 500 });
      const rows = (data ?? []) as PeriodTableRow[];
      return csvResponse(`meshkantsi-${slug}.csv`, [
        ["Таблиця мешканців"],
        ["Період", periodLabel(period!)],
        generated,
        [],
        ["Квартира", "Прізвище", "Попередній", "Поточний", "Спожито, кВт·год", "Тариф", "Електроенергія", "Депозит", "Освітлення", "Інші", "Разом", "Статус", "Подано", "Підтверджено"],
        ...rows.map((r) => [
          r.apartment_number, r.resident_surname,
          r.has_reading ? m(r.previous_reading) : "Не внесено", r.has_reading ? m(r.current_reading) : "",
          m(r.consumption_kwh), t4(r.tariff_rate), m(r.electricity_amount), m(r.deposit_contribution),
          m(r.hall_lighting_amount), m(r.other_amount), m(r.total_amount),
          PAYMENT_STATUS_LABEL[r.payment_status], r.submitted_at ? formatDateTime(r.submitted_at) : "", r.reviewed_at ? formatDateTime(r.reviewed_at) : "",
        ]),
      ]);
    }
    case "payments": {
      const { data } = await supabase
        .from("payments")
        .select("*, apartments(apartment_number, resident_surname, sort_num), receipts(count)")
        .eq("billing_period_id", period!.id);
      type P = { apartments: { apartment_number: string; resident_surname: string; sort_num: number | null }; receipts: { count: number }[]; [k: string]: unknown };
      const rows = ((data ?? []) as P[]).sort((a, b) => (a.apartments.sort_num ?? 0) - (b.apartments.sort_num ?? 0));
      return csvResponse(`platezhi-${slug}.csv`, [
        ["Платежі"],
        ["Період", periodLabel(period!)],
        generated,
        [],
        ["Квартира", "Прізвище", "Електроенергія", "Депозит", "Освітлення", "Інші", "Разом", "Статус", "Спроба", "Квитанцій", "Подано", "Переглянуто", "Без квитанції", "Причина відхилення", "Примітка"],
        ...rows.map((r) => [
          r.apartments.apartment_number, r.apartments.resident_surname, m(r.electricity_amount), m(r.deposit_contribution),
          m(r.hall_lighting_amount), m(r.other_amount), m(r.total_amount), PAYMENT_STATUS_LABEL[r.status as PaymentStatus],
          r.attempt_no, r.receipts?.[0]?.count ?? 0,
          r.submitted_at ? formatDateTime(r.submitted_at as string) : "", r.reviewed_at ? formatDateTime(r.reviewed_at as string) : "",
          r.confirmed_without_receipt ? "так" : "", r.rejection_reason ?? "", r.admin_note ?? "",
        ]),
      ]);
    }
    case "report": {
      const { data, error } = await supabase.rpc("get_house_report", { p_period_id: period!.id });
      if (error) return new Response("Помилка", { status: 500 });
      const r = data as HouseReport;
      return csvResponse(`zvit-${slug}.csv`, [
        ["Зведення за будинком"],
        ["Період", periodLabel(period!)],
        generated,
        ["Статус розрахунку", r.is_preliminary ? "Попередній (неповні дані)" : "Остаточний"],
        [],
        ["Показник", "Значення"],
        ["Споживання за загальним лічильником, кВт·год", m(r.common_consumption_kwh)],
        ["Сумарне споживання квартир, кВт·год", m(r.apartment_consumption_kwh)],
        ["Квартир із показниками", r.apartments_with_readings],
        ["Квартир без показників", r.apartments_without_readings],
        ["Різниця, кВт·год", m(r.discrepancy_kwh)],
        ["Тариф для довідки, грн/кВт·год", t4(r.tariff_rate)],
        ["Орієнтовна вартість різниці, грн", m(r.discrepancy_amount)],
        ["Нараховано за електроенергію, грн", m(r.charges.electricity)],
        ["Депозитні внески (нараховано), грн", m(r.charges.deposit)],
        ["Освітлення під'їзду (нараховано), грн", m(r.charges.hall_lighting)],
        ["Інші внески (нараховано), грн", m(r.charges.other)],
        ["Підтверджені платежі, грн", m(r.payments.paid_total)],
        ["Підтверджених платежів, шт.", r.payments.paid_count],
        ["Непідтверджені платежі (на перевірці), грн", m(r.payments.pending_total)],
        ["Не оплачено, грн", m(r.payments.awaiting_total + r.payments.rejected_total)],
        ["Баланс депозиту на початок місяця, грн", m(r.deposit.opening_balance)],
        ["Поповнення депозиту, грн", m(r.deposit.contributions)],
        ["Використання на розбіжності, грн", m(r.deposit.discrepancy_usage)],
        ["Коригування, грн", m(r.deposit.corrections)],
        ["Повернення, грн", m(r.deposit.refunds)],
        ["Баланс депозиту на кінець місяця, грн", m(r.deposit.closing_balance)],
      ]);
    }
    case "deposit": {
      let q = supabase
        .from("deposit_ledger")
        .select("*, billing_periods(year, month), apartments(apartment_number)")
        .order("created_at", { ascending: true });
      if (period) q = q.eq("billing_period_id", period.id);
      const { data } = await q;
      type L = { billing_periods: { year: number; month: number }; apartments: { apartment_number: string } | null; [k: string]: unknown };
      return csvResponse(`depozyt-${slug}.csv`, [
        ["Журнал депозиту"],
        ["Період", period ? periodLabel(period) : "Усі"],
        generated,
        [],
        ["Дата", "Період", "Тип", "Квартира", "Сума, грн", "Підстава", "Платіж", "Розбіжність"],
        ...((data ?? []) as L[]).map((l) => [
          formatDateTime(l.created_at as string), periodLabel(l.billing_periods), DEPOSIT_TX_LABEL[l.transaction_type as DepositTxType],
          l.apartments?.apartment_number ?? "", m(l.amount), l.description, l.related_payment_id ?? "", l.related_reconciliation_id ?? "",
        ]),
      ]);
    }
    case "audit": {
      const { data } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(5000);
      return csvResponse(`zhurnal-zmin-${slug}.csv`, [
        ["Журнал змін"],
        generated,
        [],
        ["Дата", "Автор", "Роль", "Дія", "Тип запису", "ID запису", "Причина", "Було", "Стало"],
        ...((data ?? []) as Record<string, unknown>[]).map((l) => [
          formatDateTime(l.created_at as string), l.actor_user_id ?? "система", l.actor_role, l.action_type, l.entity_type,
          l.entity_id ?? "", l.reason ?? "", l.previous_values ? JSON.stringify(l.previous_values) : "", l.new_values ? JSON.stringify(l.new_values) : "",
        ]),
      ]);
    }
    default:
      return new Response("Невідомий тип експорту", { status: 404 });
  }
}

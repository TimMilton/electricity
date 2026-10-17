import Link from "next/link";
import { FileDown } from "lucide-react";
import { formatKwh, formatMoney, formatTariff } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { Button, Notice, PageHeader, Panel, Row } from "@/components/ui/controls";
import { PeriodPicker, Stat } from "@/components/period-picker";
import { WindowNotice } from "@/components/charges";
import { RECONCILIATION_STATUS_LABEL, type BillingPeriod, type HouseReport } from "@/lib/types";

/** Огляд адміністратора (без звернень до даних). */
export function AdminOverviewView({ period, periods, report: r }: { period: BillingPeriod; periods: BillingPeriod[]; report: HouseReport }) {
  const extra = r.charges.deposit + r.charges.hall_lighting + r.charges.other;

  return (
    <>
      <PageHeader
        title="Огляд"
        description={periodLabel(period)}
        actions={
          <Button asChild variant="outline">
            <a href={`/api/export/report?period=${period.id}`}>
              <FileDown aria-hidden />
              Звіт CSV
            </a>
          </Button>
        }
      />
      <div className="mb-5 flex flex-col gap-3">
        <PeriodPicker periods={periods} selectedId={period.id} />
        <WindowNotice period={period} isAdmin />
        {(r.pending_review_all ?? 0) > 0 && (
          <Notice tone="signal" title={`Платежів на перевірці: ${r.pending_review_all}`}>
            <Link href="/admin/payments?status=pending_review" className="underline underline-offset-4">
              Перейти до перевірки
            </Link>
          </Notice>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Активних квартир" value={r.active_apartments} />
        <Stat label="Подали показники" value={r.apartments_with_readings} />
        <Stat label="Без показників" value={r.apartments_without_readings} tone={r.apartments_without_readings > 0 ? "warn" : undefined} />
        <Stat label="Нараховано всього" value={formatMoney(r.charges_total ?? 0)} />
        <Stat label="На перевірці" value={r.payments.pending_count} hint={formatMoney(r.payments.pending_total)} tone={r.payments.pending_count ? "signal" : undefined} />
        <Stat label="Підтверджено" value={r.payments.paid_count} hint={formatMoney(r.payments.paid_total)} tone="ok" />
        <Stat label="Відхилено" value={r.payments.rejected_count} hint={formatMoney(r.payments.rejected_total)} tone={r.payments.rejected_count ? "danger" : undefined} />
        <Stat label="Баланс депозиту" value={formatMoney(r.deposit.current_balance)} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel
          title="Загальний і квартирні лічильники"
          description={r.is_preliminary ? "Попередній розрахунок: не всі дані внесено" : "Усі квартири подали показники"}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/common-meter?period=${period.id}`}>Загальний лічильник</Link>
            </Button>
          }
        >
          <dl>
            <Row label="Споживання за загальним лічильником" value={r.common_consumption_kwh === null ? "Не внесено" : formatKwh(r.common_consumption_kwh)} />
            <Row label="Сумарне споживання квартир" value={formatKwh(r.apartment_consumption_kwh)} />
            <Row label="Різниця" value={r.discrepancy_kwh === null ? "—" : formatKwh(r.discrepancy_kwh)} strong />
            <Row label="Абсолютна різниця" value={r.discrepancy_abs_kwh === null ? "—" : formatKwh(r.discrepancy_abs_kwh)} />
            <Row label="Тариф для довідки" value={r.tariff_rate === null ? "—" : formatTariff(r.tariff_rate)} />
            <Row label="Орієнтовна вартість різниці" value={r.discrepancy_amount === null ? "—" : formatMoney(r.discrepancy_amount)} />
            {r.reconciliation && <Row label="Статус розбіжності" value={RECONCILIATION_STATUS_LABEL[r.reconciliation.status]} />}
          </dl>
          {r.discrepancy_kwh !== null && r.discrepancy_kwh < 0 && (
            <Notice tone="warn" className="mt-3">
              Сума квартирних показників перевищує загальний лічильник. Перевірте дані — депозит у такому разі не використовується.
            </Notice>
          )}
        </Panel>

        <Panel title="Нарахування та оплати" description="Нарахування й підтверджені платежі обліковуються окремо.">
          <dl>
            <Row label="Нараховано за електроенергію" value={formatMoney(r.charges.electricity)} />
            <Row label="Додаткові внески" value={formatMoney(extra)} />
            <Row label="у т. ч. депозит" value={formatMoney(r.charges.deposit)} className="pl-4 text-sm" />
            <Row label="у т. ч. освітлення під'їзду" value={formatMoney(r.charges.hall_lighting)} className="pl-4 text-sm" />
            <Row label="у т. ч. інші" value={formatMoney(r.charges.other)} className="pl-4 text-sm" />
            <Row label="Підтверджені платежі" value={formatMoney(r.payments.paid_total)} strong />
            <Row label="Непідтверджені (на перевірці)" value={formatMoney(r.payments.pending_total)} />
            <Row label="Ще не оплачено" value={formatMoney(r.payments.awaiting_total + r.payments.rejected_total)} />
          </dl>
        </Panel>

        <Panel title="Депозит за місяць" className="lg:col-span-2">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <Row label="Баланс на початок місяця" value={formatMoney(r.deposit.opening_balance)} />
            <Row label="Поповнення (підтверджені внески)" value={formatMoney(r.deposit.contributions)} />
            <Row label="Використання на розбіжності" value={formatMoney(r.deposit.discrepancy_usage)} />
            <Row label="Коригування та повернення" value={formatMoney(r.deposit.corrections + r.deposit.refunds)} />
            <Row label="Баланс на кінець місяця" value={formatMoney(r.deposit.closing_balance)} strong />
          </dl>
          <p className="mt-3 text-sm text-ink-soft">Сформовано {formatDateTime(r.generated_at)}.</p>
        </Panel>
      </div>
    </>
  );
}

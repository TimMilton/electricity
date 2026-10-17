import { Notice, Panel, Row } from "@/components/ui/controls";
import { Tag } from "@/components/ui/status";
import { ReconciliationActions } from "@/components/admin/finance";
import { fromDb, formatKwh, formatMoney, formatTariff } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { RECONCILIATION_STATUS_LABEL, type Reconciliation } from "@/lib/types";

export function ReconciliationCard({
  rec,
  periodId,
  balance,
  withPeriodTitle,
}: {
  rec: Reconciliation;
  periodId: string;
  balance: string;
  withPeriodTitle?: { year: number; month: number };
}) {
  const d = fromDb(rec.discrepancy_kwh, 2) ?? 0n;
  const abs = d < 0n ? -d : d;
  const tone = rec.status === "closed" ? "neutral" : rec.status === "adjustment_applied" ? "ok" : rec.status === "reviewed" ? "face" : "signal";
  return (
    <Panel
      title={withPeriodTitle ? `Розбіжність, ${periodLabel(withPeriodTitle).toLowerCase()}` : "Розбіжність"}
      description={`Розраховано ${formatDateTime(rec.updated_at)}`}
      actions={
        <div className="flex flex-wrap gap-1.5">
          {rec.is_preliminary && <Tag tone="warn">Неповні дані</Tag>}
          <Tag tone={tone}>{RECONCILIATION_STATUS_LABEL[rec.status]}</Tag>
        </div>
      }
    >
      <dl>
        <Row label="Загальний лічильник" value={formatKwh(rec.common_consumption_kwh)} />
        <Row label={`Сума квартир (${rec.readings_count} з ${rec.active_apartments_count})`} value={formatKwh(rec.apartment_consumption_kwh)} />
        <Row label="Різниця" value={formatKwh(rec.discrepancy_kwh)} strong />
        <Row label="Абсолютна різниця" value={formatKwh(abs)} />
        <Row label="Тариф для довідки" value={rec.tariff_rate === null ? "—" : formatTariff(rec.tariff_rate)} />
        <Row label="Орієнтовна вартість" value={rec.discrepancy_amount === null ? "—" : formatMoney(rec.discrepancy_amount)} />
        <Row label="Поточний баланс депозиту" value={formatMoney(balance)} />
      </dl>
      {rec.is_preliminary && (
        <Notice tone="warn" className="mt-3">
          Не всі квартири подали показники — розрахунок попередній і не вважається остаточним.
        </Notice>
      )}
      {d < 0n && (
        <Notice tone="warn" className="mt-3">
          Сума квартирних показників більша за загальний лічильник. Потрібна перевірка даних; депозит не зменшується.
        </Notice>
      )}
      <p className="mt-3 text-sm text-ink-soft">
        Орієнтовна вартість — довідковий розрахунок, а не борг мешканців. Розбіжність не розподіляється між квартирами автоматично.
      </p>
      {rec.explanation && <p className="mt-2 text-[15px]">Пояснення: {rec.explanation}</p>}
      <div className="mt-4">
        <ReconciliationActions
          id={rec.id}
          periodId={periodId}
          status={rec.status}
          discrepancyPositive={d > 0n}
          needsExplanation={rec.is_preliminary || d < 0n}
          estimated={rec.discrepancy_amount === null ? null : String(rec.discrepancy_amount)}
          balance={balance}
        />
      </div>
    </Panel>
  );
}

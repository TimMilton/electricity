import { Notice, Panel, Row } from "@/components/ui/controls";
import { Tag } from "@/components/ui/status";
import { ReconciliationActions } from "@/components/admin/finance";
import { fromDb, formatKwh, formatMoney, formatTariff, toDecimalString } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { RECONCILIATION_STATUS_LABEL, type Reconciliation } from "@/lib/types";

export function ReconciliationCard({
  rec,
  periodId,
  balance,
  withPeriodTitle,
  hallLighting,
}: {
  rec: Reconciliation;
  periodId: string;
  balance: string;
  withPeriodTitle?: { year: number; month: number };
  /** Нараховані внески за освітлення під'їзду за цей місяць — першими покривають різницю */
  hallLighting?: string | null;
}) {
  const d = fromDb(rec.discrepancy_kwh, 2) ?? 0n;
  const cost = fromDb(rec.discrepancy_amount, 2);
  const hall = fromDb(hallLighting ?? null, 2);
  const hallCover = cost !== null && hall !== null && cost > 0n ? (hall < cost ? hall : cost) : null;
  // Пропонована сума з депозиту — лише те, що не покрило освітлення під'їзду
  const fromDeposit = cost === null ? null : hall !== null ? (cost - hall > 0n ? cost - hall : 0n) : cost;
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
        {hallCover !== null && (
          <>
            <Row label="Покрито внесками за освітлення під'їзду" value={`−${formatMoney(hallCover)}`} />
            <Row label="Залишок до покриття з депозиту" value={formatMoney(fromDeposit ?? 0n)} strong />
          </>
        )}
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
          estimated={fromDeposit === null ? null : toDecimalString(fromDeposit, 2)}
          estimatedLabel={hallCover !== null ? "Залишок після освітлення під'їзду" : undefined}
          balance={balance}
        />
      </div>
    </Panel>
  );
}

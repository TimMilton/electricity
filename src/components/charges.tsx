import { Row, Notice } from "@/components/ui/controls";
import { formatKwh, formatMoney, formatReading, formatTariff } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import type { BillingPeriod, Num } from "@/lib/types";
import { periodPhase } from "@/lib/period";

export function ChargeBreakdown({
  electricity,
  deposit,
  hallLighting,
  other,
  total,
  showOther = true,
}: {
  electricity: Num | bigint | null;
  deposit: Num | bigint | null;
  hallLighting: Num | bigint | null;
  other: Num | bigint | null;
  total: Num | bigint | null;
  showOther?: boolean;
}) {
  return (
    <dl>
      <Row label="Електроенергія" value={formatMoney(electricity ?? 0)} />
      <Row label="Депозит" value={formatMoney(deposit ?? 0)} />
      <Row label="Освітлення під'їзду" value={formatMoney(hallLighting ?? 0)} />
      {showOther && <Row label="Інші внески" value={formatMoney(other ?? 0)} />}
      <Row label="Загальна сума" value={formatMoney(total ?? 0)} strong />
    </dl>
  );
}

export function ReadingFacts({
  previous,
  current,
  consumption,
  tariff,
}: {
  previous: Num | null;
  current: Num | null;
  consumption: Num | null;
  tariff: Num | null;
}) {
  return (
    <dl>
      <Row label="Попередній показник" value={previous === null ? "—" : formatReading(previous)} />
      <Row label="Поточний показник" value={current === null ? "Не внесено" : formatReading(current)} />
      <Row label="Споживання" value={consumption === null ? "—" : formatKwh(consumption)} />
      <Row label="Тариф" value={tariff === null ? "Не визначено" : formatTariff(tariff)} />
    </dl>
  );
}

/** Повідомлення про стан вікна приймання показників з конкретними датами. */
export function WindowNotice({ period, isAdmin }: { period: BillingPeriod; isAdmin?: boolean }) {
  const phase = periodPhase(period);
  if (phase === "open") {
    return (
      <Notice tone="signal" title={`Приймання показників за ${periodLabel(period).toLowerCase()} відкрите`}>
        До {formatDateTime(period.reading_window_end)}.
      </Notice>
    );
  }
  if (phase === "before") {
    return (
      <Notice tone="info" title="Приймання показників за цей місяць ще не розпочалося">
        Період відкриється {formatDateTime(period.reading_window_start)}.
      </Notice>
    );
  }
  return (
    <Notice tone="warn" title={`Період подання показників завершився ${formatDateTime(period.closed_at ?? period.reading_window_end)}`}>
      {isAdmin
        ? period.allow_admin_edit_after_close
          ? "Як адміністратор ви можете виправити дані — дія буде записана в журнал змін."
          : "Для цього періоду адміністративне виправлення вимкнено."
        : "Зверніться до адміністратора, якщо потрібно виправити дані."}
    </Notice>
  );
}

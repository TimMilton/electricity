import { Notice, Panel, Row } from "@/components/ui/controls";
import { Tag } from "@/components/ui/status";
import { fromDb, formatKwh, formatMoney, formatReading, formatTariff } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { RECONCILIATION_STATUS_LABEL, type HouseSummary } from "@/lib/types";

function percentOf(part: bigint, whole: bigint): string | null {
  if (whole <= 0n) return null;
  // десяті частки відсотка, округлення «половина від нуля»
  const scaled = part * 1000n;
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const q = abs / whole;
  const r = abs % whole;
  const tenth = r * 2n >= whole ? q + 1n : q;
  const s = `${tenth / 10n},${tenth % 10n}`;
  return (neg ? "−" : "") + s + "%";
}

/**
 * Порівняння загального лічильника з сумою квартирних: смуга завдовжки
 * в споживання будинку, заповнена частина — спожите квартирами за їхніми показниками.
 */
function CoverageBar({ common, apartments }: { common: bigint; apartments: bigint }) {
  if (common <= 0n) return null;
  const share = apartments >= common ? 100 : Number((apartments * 1000n) / common) / 10;
  const over = apartments > common;
  return (
    <div className="mt-3" aria-hidden>
      <div className="flex h-3 overflow-hidden rounded-full bg-signal-soft ring-1 ring-signal/60">
        <div className={over ? "bg-warn" : "bg-face"} style={{ width: `${share}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-sm text-ink-soft">
        <span>Квартири</span>
        <span>{over ? "Квартири більше за будинок" : "Не враховано квартирами"}</span>
      </div>
    </div>
  );
}

/** Блок «Будинок»: загальний лічильник, різниця з квартирами, борг у гривнях, депозит. */
export function HouseSummaryPanel({
  summary,
  compact,
  failed,
}: {
  summary: HouseSummary | null;
  compact?: boolean;
  /** Запит до бази завершився помилкою (напр. не застосовано міграцію) */
  failed?: boolean;
}) {
  if (failed) {
    return (
      <Panel title="Будинок" description="Загальний лічильник, різниця з квартирами, борг і депозит">
        <Notice tone="warn" title="Не вдалося завантажити дані будинку">
          Спробуйте оновити сторінку пізніше. Якщо повідомлення не зникає, зверніться до адміністратора: у базі даних може бракувати
          оновлення <span className="whitespace-nowrap">20261018000001_house_summary.sql</span>.
        </Notice>
      </Panel>
    );
  }
  if (!summary) return null;
  const title = summary.period ? `Будинок: ${summary.period.label.toLowerCase()}` : "Будинок";

  if (!summary.has_common) {
    return (
      <Panel title={title} description="Загальний лічильник, за яким будинок платить постачальнику">
        <p className="text-ink-soft">
          {summary.period
            ? "Показник загального лічильника за цей місяць адміністратор ще не вніс."
            : "Адміністратор ще не вносив показник загального лічильника."}
        </p>
        {summary.deposit_public && summary.deposit_balance !== null && (
          <dl className="mt-3 border-t border-line pt-2">
            <Row label="Баланс депозиту будинку" value={formatMoney(summary.deposit_balance)} strong />
          </dl>
        )}
      </Panel>
    );
  }

  const commonKwh = fromDb(summary.common_kwh, 2) ?? 0n;
  const aptKwh = fromDb(summary.apartments_kwh, 2) ?? 0n;
  const disc = fromDb(summary.discrepancy_kwh, 2) ?? 0n;
  const debt = fromDb(summary.discrepancy_amount, 2);
  const after = fromDb(summary.deposit_after, 2);
  const pct = percentOf(disc, commonKwh);
  const status = summary.reconciliation_status;

  return (
    <Panel
      title={title}
      description="Загальний лічильник, за яким будинок фактично платить постачальнику, і різниця з показниками квартир"
      actions={
        <div className="flex flex-wrap gap-1.5">
          {summary.is_preliminary && <Tag tone="warn">Неповні дані</Tag>}
          {status && status !== "calculated" && <Tag tone={status === "reviewed" ? "face" : "ok"}>{RECONCILIATION_STATUS_LABEL[status]}</Tag>}
        </div>
      }
    >
      <div className={compact ? "grid gap-5 lg:grid-cols-2" : "grid gap-5 md:grid-cols-2"}>
        <section aria-label="Споживання">
          <h3 className="mb-1 font-semibold">Споживання, кВт·год</h3>
          <dl>
            <Row
              label="Загальний лічильник"
              value={`${formatReading(summary.common_previous)} → ${formatReading(summary.common_current)}`}
            />
            <Row label="Спожито будинком" value={formatKwh(summary.common_kwh)} />
            <Row
              label={`Сума показників квартир (${summary.apartments_with_readings} з ${summary.active_apartments})`}
              value={formatKwh(summary.apartments_kwh)}
            />
            <Row
              label="Різниця"
              value={
                <>
                  {formatKwh(summary.discrepancy_kwh)}
                  {pct && <span className="ml-1 text-sm font-normal text-ink-soft">({pct})</span>}
                </>
              }
              strong
            />
          </dl>
          <CoverageBar common={commonKwh} apartments={aptKwh} />
        </section>

        <section aria-label="Борг у гривнях">
          <h3 className="mb-1 font-semibold">
            Розрахунок у гривнях
            {summary.tariff_rate != null && (
              <span className="ml-1 text-sm font-normal text-ink-soft">за тарифом {formatTariff(summary.tariff_rate)}</span>
            )}
          </h3>
          {summary.tariff_rate == null ? (
            <p className="text-ink-soft">Тариф для цього місяця не визначено.</p>
          ) : (
            <dl>
              <Row label="До сплати за загальним лічильником" value={formatMoney(summary.common_amount)} />
              <Row label="Нараховано квартирам за електроенергію" value={formatMoney(summary.apartments_amount)} />
              <Row
                label={debt !== null && debt > 0n ? "Борг: не покрито квартирами" : "Різниця"}
                value={formatMoney(summary.discrepancy_amount)}
                strong
                className={debt !== null && debt > 0n ? "[&_dd]:text-danger" : undefined}
              />
              {summary.deposit_public && summary.deposit_balance !== null && (
                <>
                  <Row label="Баланс депозиту будинку" value={formatMoney(summary.deposit_balance)} />
                  {after !== null &&
                    (after >= 0n ? (
                      <Row label="Залишиться після покриття боргу" value={formatMoney(after)} />
                    ) : (
                      <Row label="Не вистачає на депозиті" value={formatMoney(-after)} className="[&_dd]:text-danger" />
                    ))}
                </>
              )}
            </dl>
          )}
        </section>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {summary.is_preliminary && (
          <Notice tone="warn">
            Показники подали не всі квартири (бракує: {summary.apartments_missing}). Різниця попередня і зменшиться, коли решта
            внесуть показники.
          </Notice>
        )}
        {disc < 0n && (
          <Notice tone="info">
            Сума квартирних показників більша за загальний лічильник. Борг не виникає; адміністратор перевіряє дані.
          </Notice>
        )}
        {summary.deposit_already_applied && (
          <Notice tone="ok">Різницю за цей місяць уже враховано: адміністратор покрив її з депозиту.</Notice>
        )}
      </div>

      <p className="mt-3 text-sm text-ink-soft">
        Орієнтовний розрахунок. Борг не розподіляється між квартирами автоматично — рішення про використання депозиту ухвалює
        адміністратор.
        {summary.common_updated_at && ` Показник загального лічильника внесено ${formatDateTime(summary.common_updated_at)}.`}
      </p>
    </Panel>
  );
}

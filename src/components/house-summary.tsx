import { ExternalLink } from "lucide-react";
import { Notice, Panel, Row } from "@/components/ui/controls";
import { Tag } from "@/components/ui/status";
import { fromDb, formatKwh, formatMoney, formatReading, formatTariff } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { RECONCILIATION_STATUS_LABEL, type HouseSummary } from "@/lib/types";
import { ReceiptList } from "@/components/receipt-list";
import type { HouseReceiptView } from "@/lib/house-receipts";

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

/** Посилання на спільний конверт — щоб будь-коли переглянути баланс. */
export function EnvelopeLink({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-signal px-3 text-sm font-semibold text-ink hover:brightness-95"
    >
      <ExternalLink className="size-4" aria-hidden />
      Конверт: переглянути баланс
    </a>
  );
}

/**
 * Збори за місяць: електроенергія квартир і окремо внески поза нею
 * (депозит, освітлення під'їзду, інші) — скільки на конверті понад лічильники квартир.
 */
function CollectionsSection({ summary }: { summary: HouseSummary }) {
  if (summary.charged_total === undefined) return null; // база ще без цих полів
  const other = fromDb(summary.charged_other ?? 0, 2) ?? 0n;
  const topupsPaid = fromDb(summary.topups_paid ?? 0, 2) ?? 0n;
  const topupsPending = fromDb(summary.topups_pending ?? 0, 2) ?? 0n;
  // Підтверджені окремі внески в депозит теж надходять на конверт
  const paidTotal = (fromDb(summary.paid_total ?? 0, 2) ?? 0n) + topupsPaid;
  const paidExtras = (fromDb(summary.paid_extras ?? 0, 2) ?? 0n) + topupsPaid;
  return (
    <section aria-label="Збори за місяць" className="mt-5 border-t border-line pt-4">
      <h3 className="mb-1 font-semibold">Збори з квартир за місяць</h3>
      <div className="grid gap-x-5 md:grid-cols-2">
        <dl>
          <Row label="За електроенергію (за лічильниками квартир)" value={formatMoney(summary.apartments_amount ?? 0)} />
          <Row label="Депозит" value={formatMoney(summary.charged_deposit ?? 0)} />
          <Row label="Освітлення під'їзду" value={formatMoney(summary.charged_hall_lighting ?? 0)} />
          {other > 0n && <Row label="Інші внески" value={formatMoney(summary.charged_other ?? 0)} />}
          {(topupsPaid > 0n || topupsPending > 0n) && (
            <Row
              label="Окремі внески в депозит"
              value={
                <>
                  {formatMoney(topupsPaid)}
                  {topupsPending > 0n && (
                    <span className="ml-1 text-sm font-normal text-ink-soft">(+{formatMoney(topupsPending)} на перевірці)</span>
                  )}
                </>
              }
            />
          )}
        </dl>
        <dl>
          <Row
            label={other > 0n ? "Інші нарахування (депозит + освітлення + інші)" : "Інші нарахування (депозит + освітлення)"}
            value={formatMoney(summary.charged_extras ?? 0)}
            strong
          />
          <Row label="Усього нараховано квартирам" value={formatMoney(summary.charged_total ?? 0)} />
          <Row label={topupsPaid > 0n ? "Підтверджено надходжень (з окремими внесками)" : "Підтверджено оплат"} value={formatMoney(paidTotal)} />
          {paidTotal > 0n && <Row label="з них інші нарахування" value={formatMoney(paidExtras)} />}
        </dl>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        «Інші нарахування» — кошти на конверті понад лічильники квартир: депозит і освітлення під&apos;їзду.
      </p>
    </section>
  );
}

/** Квитанції про оплату за загальним лічильником (мешканцям — після закриття періоду). */
function HouseReceiptsSection({ receipts }: { receipts: HouseReceiptView[] | undefined }) {
  if (!receipts || receipts.length === 0) return null;
  const notes = [...new Set(receipts.map((r) => r.note).filter((n): n is string => !!n))];
  return (
    <section aria-label="Квитанція про оплату за загальним лічильником" className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 font-semibold">Квитанція про оплату за загальним лічильником</h3>
      {notes.map((n) => (
        <p key={n} className="mb-2 text-[15px]">{n}</p>
      ))}
      <ReceiptList receipts={receipts} />
    </section>
  );
}

/** Блок «Будинок»: загальний лічильник, різниця з квартирами, борг у гривнях, депозит. */
export function HouseSummaryPanel({
  summary,
  compact,
  failed,
  envelopeUrl,
  houseReceipts,
}: {
  summary: HouseSummary | null;
  compact?: boolean;
  /** Запит до бази завершився помилкою (напр. не застосовано міграцію) */
  failed?: boolean;
  /** Посилання на конверт із налаштувань — показується завжди, навіть без даних будинку */
  envelopeUrl?: string | null;
  /** Квитанції будинку за місяць зведення (мешканцям — лише за закритий період) */
  houseReceipts?: HouseReceiptView[];
}) {
  const envelope = summary?.envelope_url ?? envelopeUrl ?? null;
  if (failed) {
    return (
      <Panel title="Будинок" description="Загальний лічильник, різниця з квартирами, борг і депозит" actions={<EnvelopeLink url={envelope} />}>
        <Notice tone="warn" title="Не вдалося завантажити дані будинку">
          Спробуйте оновити сторінку пізніше. Якщо повідомлення не зникає, зверніться до адміністратора: у базі даних може бракувати
          оновлення <span className="whitespace-nowrap">20261018000001_house_summary.sql</span>.
        </Notice>
      </Panel>
    );
  }
  if (!summary) {
    return envelope ? (
      <Panel title="Будинок" actions={<EnvelopeLink url={envelope} />}>
        <p className="text-ink-soft">Даних будинку ще немає.</p>
      </Panel>
    ) : null;
  }
  const title = summary.period ? `Будинок: ${summary.period.label.toLowerCase()}` : "Будинок";

  if (!summary.has_common) {
    return (
      <Panel title={title} description="Загальний лічильник, за яким будинок платить постачальнику" actions={<EnvelopeLink url={envelope} />}>
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
        {summary.period && <CollectionsSection summary={summary} />}
        <HouseReceiptsSection receipts={houseReceipts} />
      </Panel>
    );
  }

  const commonKwh = fromDb(summary.common_kwh, 2) ?? 0n;
  const aptKwh = fromDb(summary.apartments_kwh, 2) ?? 0n;
  const disc = fromDb(summary.discrepancy_kwh, 2) ?? 0n;
  const debt = fromDb(summary.discrepancy_amount, 2);
  const after = fromDb(summary.deposit_after, 2);
  // Нова база: різниця спершу покривається внесками за освітлення під'їзду
  const hasHall = summary.debt_after_hall_lighting !== undefined && summary.debt_after_hall_lighting !== null;
  const afterHall = hasHall ? fromDb(summary.debt_after_hall_lighting, 2) : null;
  const hallCharged = fromDb(summary.charged_hall_lighting ?? 0, 2) ?? 0n;
  const debtLeft = afterHall ?? debt; // що лишається покрити депозитом
  const pct = percentOf(disc, commonKwh);
  const status = summary.reconciliation_status;

  return (
    <Panel
      title={title}
      description="Загальний лічильник, за яким будинок фактично платить постачальнику, і різниця з показниками квартир"
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <EnvelopeLink url={envelope} />
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
              <Row label="Сума будинку за світло (загальний лічильник)" value={formatMoney(summary.common_amount)} strong />
              <Row label="Нараховано квартирам за електроенергію" value={formatMoney(summary.apartments_amount)} />
              <Row
                label={debt !== null && debt > 0n ? (hasHall ? "Різниця: не покрито лічильниками квартир" : "Борг: не покрито квартирами") : "Різниця"}
                value={formatMoney(summary.discrepancy_amount)}
                strong={!hasHall}
                className={!hasHall && debt !== null && debt > 0n ? "[&_dd]:text-danger" : undefined}
              />
              {hasHall && debt !== null && debt > 0n && (
                <>
                  <Row
                    label="Покрито внесками за освітлення під'їзду"
                    value={hallCharged > 0n ? `−${formatMoney(summary.hall_lighting_cover ?? 0)}` : formatMoney(0)}
                  />
                  {afterHall !== null && afterHall > 0n ? (
                    <Row label="Борг після освітлення під'їзду" value={formatMoney(afterHall)} strong className="[&_dd]:text-danger" />
                  ) : (
                    <Row label="Борг після освітлення під'їзду" value={formatMoney(0)} strong className="[&_dd]:text-ok" />
                  )}
                  {afterHall !== null && afterHall < 0n && (
                    <Row label="Надлишок внесків за освітлення" value={formatMoney(-afterHall)} className="[&_dd]:text-ok" />
                  )}
                </>
              )}
              {summary.deposit_public && summary.deposit_balance !== null && (
                <>
                  <Row label="Баланс депозиту будинку" value={formatMoney(summary.deposit_balance)} />
                  {after !== null && debtLeft !== null && debtLeft > 0n &&
                    (after >= 0n ? (
                      <Row
                        label={
                          summary.deposit_already_applied
                            ? "Залишиться на депозиті після покриття решти боргу"
                            : hasHall
                              ? "Залишиться на депозиті після покриття боргу"
                              : "Залишиться після покриття боргу"
                        }
                        value={formatMoney(after)}
                      />
                    ) : (
                      <Row label="Не вистачає на депозиті" value={formatMoney(-after)} className="[&_dd]:text-danger" />
                    ))}
                </>
              )}
            </dl>
          )}
        </section>
      </div>

      <CollectionsSection summary={summary} />
      <HouseReceiptsSection receipts={houseReceipts} />

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
          <Notice tone="ok">
            Адміністратор уже покрив з депозиту
            {summary.deposit_used != null ? ` ${formatMoney(summary.deposit_used)}` : " частину різниці"} за цей місяць
            {after !== null ? "; решту боргу показано вище." : "."}
          </Notice>
        )}
      </div>

      <p className="mt-3 text-sm text-ink-soft">
        Орієнтовний розрахунок.{hasHall && " Різницю спершу покривають внески за освітлення під'їзду (воно живиться від загального лічильника), залишок — депозит."}{" "}
        Борг не розподіляється між квартирами автоматично — рішення про використання депозиту ухвалює адміністратор.
        {summary.common_updated_at && ` Показник загального лічильника внесено ${formatDateTime(summary.common_updated_at)}.`}
      </p>
    </Panel>
  );
}

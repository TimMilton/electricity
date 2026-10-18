import Link from "next/link";
import { Calculator, CreditCard, Gauge, History, Users } from "lucide-react";
import { periodPhase } from "@/lib/period";
import { formatKwh, formatMoney, formatReading } from "@/lib/money";
import { formatDate, formatDateTime, periodLabel } from "@/lib/utils";
import { Button, EmptyState, Notice, Panel } from "@/components/ui/controls";
import { MeterDrum, PaymentStatusBadge } from "@/components/ui/status";
import { ChargeBreakdown, WindowNotice } from "@/components/charges";
import { ReceiptList } from "@/components/receipt-list";
import type { ReceiptView } from "@/lib/receipts";
import { HouseSummaryPanel } from "@/components/house-summary";
import type { BillingPeriod, HouseSummary, MeterReading, Payment } from "@/lib/types";

export type HomeViewProps = {
  apartment: { apartment_number: string; resident_surname: string };
  period: BillingPeriod | null;
  isAdmin: boolean;
  otherEnabled: boolean;
  deposit: { is_public: boolean; balance: number | string | null } | null;
  /** Загальний лічильник, різниця з квартирами, борг і депозит */
  house?: HouseSummary | null;
  state: {
    reading: MeterReading | null;
    charges: { deposit: string; hallLighting: string; other: string } | null;
    payment: Payment | null;
    receipts: ReceiptView[];
    previous: { value: string | null; recordedAt: string | null };
  } | null;
};

/** Головна сторінка мешканця (без звернень до даних — використовується і в попередньому перегляді). */
export function HomeView({ apartment, period, isAdmin, otherEnabled, deposit: dep, house, state }: HomeViewProps) {
  if (!period || !state) {
    return (
      <div className="flex flex-col gap-5">
        <ApartmentHeading number={apartment.apartment_number} surname={apartment.resident_surname} />
        <EmptyState title="Розрахунковий період ще не створено">
          Адміністратор ще не відкрив приймання показників. Спробуйте пізніше.
        </EmptyState>
        <HouseSummaryPanel summary={house ?? null} />
      </div>
    );
  }
  const settings = { other_charges_enabled: otherEnabled };
  const ctx = { apartment, session: { isAdmin } };
  const phase = periodPhase(period);
  const canEnter = phase === "open" || isAdmin;
  const status = state.payment?.status ?? "awaiting_payment";
  const locked = status === "pending_review" || status === "paid";
  const r = state.reading;

  return (
    <div className="flex flex-col gap-5">
      <ApartmentHeading number={ctx.apartment.apartment_number} surname={ctx.apartment.resident_surname} />

      <section aria-labelledby="period-title" className="overflow-hidden rounded-[var(--radius-panel)] bg-face text-white">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div>
            <p className="text-sm text-white/70">Розрахунковий місяць</p>
            <h2 id="period-title" className="font-display text-2xl font-bold">{periodLabel(period)}</h2>
            <p className="mt-1 text-sm text-white/80">
              Приймання показників: {formatDateTime(period.reading_window_start)} – {formatDateTime(period.reading_window_end)}
            </p>
          </div>
          <span
            className={
              phase === "open"
                ? "rounded-full bg-signal px-3 py-1 text-sm font-semibold text-ink"
                : "rounded-full bg-white/15 px-3 py-1 text-sm font-medium"
            }
          >
            {phase === "open" ? "Приймання відкрите" : phase === "before" ? "Ще не відкрито" : "Приймання завершено"}
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-4 bg-face-strong/60 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-sm text-white/70">{r ? "Поточний показник, кВт·год" : "Показник ще не внесено"}</p>
            <MeterDrum value={r ? String(r.current_reading) : null} />
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[15px] sm:text-right">
            <dt className="text-white/70">Попередній</dt>
            <dd className="tabular font-semibold">{state.previous.value ? formatReading(state.previous.value) : "—"}</dd>
            <dt className="text-white/70">Споживання</dt>
            <dd className="tabular font-semibold">{r ? formatKwh(r.consumption_kwh) : "—"}</dd>
          </dl>
        </div>
      </section>

      {!r && <WindowNotice period={period} isAdmin={ctx.session.isAdmin} />}
      {r?.is_anomaly && (
        <Notice tone="warn" title="Споживання значно вище звичайного">
          Перевірте, чи правильно внесено показник. Якщо помилка — виправте його, поки триває приймання.
        </Notice>
      )}

      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
        <Panel
          title="Нарахування"
          actions={<PaymentStatusBadge status={status} />}
          description={state.previous.recordedAt && !r ? `Останній зафіксований показник: ${formatDate(state.previous.recordedAt)}` : undefined}
        >
          {r && state.charges ? (
            <ChargeBreakdown
              electricity={r.electricity_amount}
              deposit={state.charges.deposit}
              hallLighting={state.charges.hallLighting}
              other={state.charges.other}
              total={state.payment?.total_amount ?? null}
              showOther={settings.other_charges_enabled || state.charges.other !== "0"}
            />
          ) : (
            <p className="text-ink-soft">Після внесення показника тут з&apos;явиться розрахунок суми.</p>
          )}
          {status === "rejected" && state.payment?.rejection_reason && (
            <Notice tone="danger" title="Оплату не отримано" className="mt-4">
              Причина: {state.payment.rejection_reason}. Перевірте переказ і надішліть квитанцію повторно.
            </Notice>
          )}
          {status === "pending_review" && (
            <p className="mt-4 text-[15px] text-ink-soft">Надіслано на перевірку {formatDateTime(state.payment?.submitted_at)}.</p>
          )}
          {status === "paid" && (
            <p className="mt-4 text-[15px] font-medium text-ok">Оплату підтверджено {formatDateTime(state.payment?.reviewed_at)}.</p>
          )}
          {state.receipts.length > 0 && (
            <div className="mt-4">
              <ReceiptList receipts={state.receipts} />
            </div>
          )}
        </Panel>

        <Panel title="Дії">
          <div className="flex flex-col gap-2">
            {canEnter && !locked ? (
              <Button asChild size="lg">
                <Link href="/readings">
                  <Gauge aria-hidden />
                  {r ? "Змінити показники" : "Внести показники"}
                </Link>
              </Button>
            ) : (
              <p className="rounded-[var(--radius-control)] bg-casing px-3 py-2.5 text-[15px] text-ink-soft">
                {locked
                  ? "Платіж уже подано — зміни показників можливі лише через адміністратора."
                  : phase === "before"
                    ? `Внесення показників стане доступним ${formatDateTime(period.reading_window_start)}.`
                    : "Приймання показників завершено. Для виправлення зверніться до адміністратора."}
              </p>
            )}
            {r && !locked && (
              <Button asChild variant="outline" size="lg">
                <Link href="/readings#calc">
                  <Calculator aria-hidden />
                  Розрахувати суму
                </Link>
              </Button>
            )}
            {r && (status === "awaiting_payment" || status === "rejected") && state.payment && Number(state.payment.total_amount) > 0 && (
              <Button asChild variant="signal" size="lg">
                <Link href="/pay">
                  <CreditCard aria-hidden />
                  Оплатити {formatMoney(state.payment.total_amount)}
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/history">
                <History aria-hidden />
                Переглянути історію
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/residents">
                <Users aria-hidden />
                Список мешканців
              </Link>
            </Button>
          </div>
          {!house && dep?.is_public && dep.balance !== null && (
            <p className="mt-5 border-t border-line pt-4 text-[15px]">
              Баланс депозиту будинку: <span className="tabular font-semibold">{formatMoney(dep.balance)}</span>
            </p>
          )}
        </Panel>
      </div>

      <HouseSummaryPanel summary={house ?? null} />
    </div>
  );
}

function ApartmentHeading({ number, surname }: { number: string; surname: string }) {
  return (
    <div>
      <h1 className="font-display text-[28px] font-bold leading-tight sm:text-[32px]">Квартира №{number}</h1>
      <p className="text-ink-soft">{surname}</p>
    </div>
  );
}

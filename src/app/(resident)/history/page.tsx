import type { Metadata } from "next";
import { requireActingContext } from "@/lib/auth";
import { listPeriods } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { formatKwh, formatMoney, formatReading } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { EmptyState, PageHeader, Panel } from "@/components/ui/controls";
import { PaymentStatusBadge, Tag } from "@/components/ui/status";
import { DEPOSIT_TX_LABEL, type DepositTxType, type MeterReading, type Payment } from "@/lib/types";

export const metadata: Metadata = { title: "Історія" };

type DepositSummary = {
  is_public: boolean;
  balance: number | null;
  total_contributions: number | null;
  public_note: string | null;
  usage: { id: string; period_label: string; transaction_type: DepositTxType; amount: number; description: string; created_at: string }[] | null;
  my_contributions: { period_id: string; period_label: string; declared_amount: number; payment_status: Payment["status"]; confirmed: boolean; confirmed_at: string | null }[];
};

export default async function HistoryPage() {
  const ctx = await requireActingContext();
  const supabase = await createClient();
  const aptId = ctx.apartment.id;
  const [periods, readingsRes, chargesRes, paymentsRes, depositRes] = await Promise.all([
    listPeriods(),
    supabase.from("meter_readings").select("*").eq("apartment_id", aptId),
    supabase.from("additional_charges").select("billing_period_id, charge_type, amount").eq("apartment_id", aptId),
    supabase.from("payments").select("*").eq("apartment_id", aptId),
    supabase.rpc("get_deposit_summary"),
  ]);
  const readings = (readingsRes.data ?? []) as MeterReading[];
  const charges = (chargesRes.data ?? []) as { billing_period_id: string; charge_type: string; amount: number }[];
  const payments = (paymentsRes.data ?? []) as Payment[];
  // У режимі перегляду адміністратором зведення депозиту стосується профілю адміністратора, тож внески беремо з платежів
  const deposit = depositRes.data as DepositSummary | null;

  const rows = periods
    .map((p) => ({
      period: p,
      reading: readings.find((r) => r.billing_period_id === p.id) ?? null,
      payment: payments.find((x) => x.billing_period_id === p.id) ?? null,
      charge: (t: string) => charges.find((c) => c.billing_period_id === p.id && c.charge_type === t)?.amount ?? 0,
    }))
    .filter((r) => r.reading || r.payment);

  const myContrib = payments
    .filter((p) => Number(p.deposit_contribution) > 0)
    .map((p) => ({ ...p, period: periods.find((x) => x.id === p.billing_period_id) }))
    .sort((a, b) => (b.period?.year ?? 0) * 12 + (b.period?.month ?? 0) - ((a.period?.year ?? 0) * 12 + (a.period?.month ?? 0)));

  return (
    <>
      <PageHeader title="Історія" description={`Нарахування та платежі квартири №${ctx.apartment.apartment_number} за всі місяці.`} />
      <div className="flex flex-col gap-5">
        {rows.length === 0 ? (
          <EmptyState title="Історії ще немає">Після першого внесення показників тут з&apos;являться нарахування та платежі.</EmptyState>
        ) : (
          <ol className="flex flex-col gap-3">
            {rows.map(({ period, reading, payment, charge }) => (
              <li key={period.id}>
                <Panel>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold">{periodLabel(period)}</h2>
                      {reading && (
                        <p className="tabular text-[15px] text-ink-soft">
                          {formatReading(reading.previous_reading)} → {formatReading(reading.current_reading)}, {formatKwh(reading.consumption_kwh)}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="tabular text-xl font-bold">{payment ? formatMoney(payment.total_amount) : "—"}</p>
                      {payment && <PaymentStatusBadge status={payment.status} />}
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[15px] sm:grid-cols-4">
                    <div>
                      <dt className="text-sm text-ink-soft">Електроенергія</dt>
                      <dd className="tabular">{formatMoney(reading?.electricity_amount ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-soft">Депозит</dt>
                      <dd className="tabular">{formatMoney(charge("deposit_contribution"))}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-soft">Освітлення</dt>
                      <dd className="tabular">{formatMoney(charge("hall_lighting"))}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-soft">Інші</dt>
                      <dd className="tabular">{formatMoney(charge("other"))}</dd>
                    </div>
                  </dl>
                  {payment?.status === "rejected" && payment.rejection_reason && (
                    <p className="mt-2 text-[15px] text-danger">Причина відхилення: {payment.rejection_reason}</p>
                  )}
                  {payment?.status === "paid" && (
                    <p className="mt-2 text-sm text-ok">Підтверджено {formatDateTime(payment.reviewed_at)}</p>
                  )}
                </Panel>
              </li>
            ))}
          </ol>
        )}

        <Panel title="Мої депозитні внески" description="Внесок зараховується до депозиту будинку лише після підтвердження оплати адміністратором.">
          {myContrib.length === 0 ? (
            <p className="text-ink-soft">Депозитних внесків ще не було.</p>
          ) : (
            <ul className="divide-y divide-line">
              {myContrib.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{p.period ? periodLabel(p.period) : "—"}</span>
                  <span className="flex items-center gap-3">
                    <span className="tabular font-semibold">{formatMoney(p.deposit_contribution)}</span>
                    {p.status === "paid" ? <Tag tone="ok">Зараховано</Tag> : <Tag tone="neutral">Не підтверджено</Tag>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {deposit?.is_public && (
          <Panel
            title="Депозит будинку"
            description="Спільний резерв для покриття розбіжностей між загальним лічильником і сумою квартирних."
          >
            <p className="text-[15px]">
              Поточний баланс: <span className="tabular text-xl font-bold">{formatMoney(deposit.balance)}</span>
            </p>
            {deposit.public_note && <p className="mt-2 text-[15px] text-ink-soft">{deposit.public_note}</p>}
            <h3 className="mb-2 mt-4 font-semibold">Використання депозиту</h3>
            {deposit.usage && deposit.usage.length > 0 ? (
              <ul className="divide-y divide-line">
                {deposit.usage.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[15px]">
                    <span>
                      <span className="font-medium">{DEPOSIT_TX_LABEL[u.transaction_type]}</span>, {u.period_label.toLowerCase()}: {u.description}
                    </span>
                    <span className="tabular font-semibold">{formatMoney(u.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-soft">Депозит ще не використовувався.</p>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}

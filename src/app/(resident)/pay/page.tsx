import type { Metadata } from "next";
import Link from "next/link";
import { requireActingContext } from "@/lib/auth";
import { getCurrentPeriod, getSettings, listPeriods } from "@/lib/data";
import { getApartmentPeriodState, getUnpaidPayments } from "@/lib/resident-data";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { UnpaidNotice } from "@/components/unpaid-notice";
import { Button, EmptyState, Notice, PageHeader, Panel } from "@/components/ui/controls";
import { PaymentStatusBadge } from "@/components/ui/status";
import { PaymentFlow } from "@/components/payment-flow";
import { ReceiptList } from "@/components/receipt-list";
import { AddReceiptForm } from "@/components/receipt-upload";

export const metadata: Metadata = { title: "Оплата" };

export default async function PayPage({ searchParams }: PageProps<"/pay">) {
  const ctx = await requireActingContext();
  const sp = await searchParams;
  const settings = await getSettings();
  const periods = await listPeriods();
  const current = await getCurrentPeriod();
  const unpaid = await getUnpaidPayments(ctx.apartment.id);
  // Без явного вибору: поточний місяць, а якщо за ним оплачувати нічого — найновіший неоплачений.
  // Оплата не залежить від вікна приймання показників (після 5 числа теж можна оплатити).
  const explicit = typeof sp.period === "string" ? periods.find((p) => p.id === sp.period) : undefined;
  const currentUnpaid = current ? unpaid.some((u) => u.periodId === current.id) : false;
  const fallback = !currentUnpaid && unpaid[0] ? periods.find((p) => p.id === unpaid[0]!.periodId) : undefined;
  const period = explicit || fallback || current;
  const otherUnpaid = unpaid.filter((u) => u.periodId !== period?.id);

  if (!period) {
    return (
      <>
        <PageHeader title="Оплата" />
        <EmptyState title="Розрахунковий період ще не створено" />
      </>
    );
  }

  const state = await getApartmentPeriodState(ctx.apartment.id, period.id);
  const payment = state.payment;

  if (!state.reading || !payment) {
    return (
      <>
        <PageHeader title="Оплата" description={periodLabel(period)} />
        <UnpaidNotice items={otherUnpaid} className="mb-5" />
        <EmptyState title="Спочатку внесіть показники">
          Сума до сплати з&apos;явиться після внесення показника лічильника.{" "}
          <Link href="/readings" className="text-face underline underline-offset-4">Внести показники</Link>
        </EmptyState>
      </>
    );
  }

  const amounts = {
    electricity: String(payment.electricity_amount),
    deposit: String(payment.deposit_contribution),
    hallLighting: String(payment.hall_lighting_amount),
    other: String(payment.other_amount),
    total: String(payment.total_amount),
  };

  return (
    <>
      <PageHeader title="Оплата" description={`Квартира №${ctx.apartment.apartment_number}, ${periodLabel(period).toLowerCase()}`} />
      <UnpaidNotice items={otherUnpaid} className="mb-5" />
      {payment.status === "awaiting_payment" || payment.status === "rejected" ? (
        Number(payment.total_amount) > 0 ? (
          <PaymentFlow
            paymentId={payment.id}
            periodLabel={periodLabel(period)}
            amounts={amounts}
            envelopeUrl={settings.envelope_url}
            maxSizeMb={settings.max_receipt_size_mb}
            showOther={settings.other_charges_enabled || Number(payment.other_amount) > 0}
            rejectionReason={payment.status === "rejected" ? payment.rejection_reason : null}
          />
        ) : (
          <Notice tone="info">Сума до сплати за цей місяць — 0 грн. Оплата не потрібна.</Notice>
        )
      ) : (
        <div className="flex flex-col gap-5">
          <Panel
            title={payment.status === "paid" ? "Оплату підтверджено" : "Платіж на перевірці"}
            actions={<PaymentStatusBadge status={payment.status} />}
          >
            <p className="text-[15px]">
              Сума: <span className="tabular font-semibold">{formatMoney(payment.total_amount)}</span>
            </p>
            <p className="text-[15px] text-ink-soft">Надіслано: {formatDateTime(payment.submitted_at)}</p>
            {payment.status === "paid" && <p className="text-[15px] text-ok">Підтверджено: {formatDateTime(payment.reviewed_at)}</p>}
            {state.receipts.length > 0 ? (
              <div className="mt-4">
                <ReceiptList receipts={state.receipts} />
              </div>
            ) : (
              <p className="mt-4 text-ink-soft">Квитанцію не завантажено.</p>
            )}
          </Panel>
          {payment.status === "pending_review" && (
            <Panel title="Додати ще одну квитанцію">
              <AddReceiptForm paymentId={payment.id} maxSizeMb={settings.max_receipt_size_mb} />
            </Panel>
          )}
          <Button asChild variant="outline">
            <Link href="/home">На головну</Link>
          </Button>
        </div>
      )}
    </>
  );
}

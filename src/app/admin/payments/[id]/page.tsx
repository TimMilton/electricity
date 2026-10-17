import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { signedReceipts } from "@/lib/receipts";
import { formatMoney } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { Button, Notice, PageHeader, Panel, Row } from "@/components/ui/controls";
import { PaymentStatusBadge, PAYMENT_STATUS_LABEL } from "@/components/ui/status";
import { ChargeBreakdown } from "@/components/charges";
import { ReceiptList } from "@/components/receipt-list";
import { AddReceiptForm } from "@/components/receipt-upload";
import { PaymentReview } from "@/components/admin/payment-review";
import { enterViewAsAction } from "@/app/actions/admin";
import type { Payment, PaymentEvent, Receipt } from "@/lib/types";

export const metadata: Metadata = { title: "Платіж" };

const EVENT_LABEL: Record<PaymentEvent["event_type"], string> = {
  created: "Нарахування створено",
  amounts_updated: "Суми оновлено",
  submitted: "Надіслано на перевірку",
  receipt_added: "Додано квитанцію",
  approved: "Підтверджено",
  rejected: "Відхилено",
};

export default async function AdminPaymentPage({ params }: PageProps<"/admin/payments/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("*, apartments(id, apartment_number, resident_surname), billing_periods(year, month)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const payment = data as Payment & {
    apartments: { id: string; apartment_number: string; resident_surname: string };
    billing_periods: { year: number; month: number };
  };
  const [{ data: receipts }, { data: events }, { data: ledger }, settings] = await Promise.all([
    supabase.from("receipts").select("*").eq("payment_id", id).order("created_at", { ascending: false }),
    supabase.from("payment_events").select("*").eq("payment_id", id).order("created_at"),
    supabase.from("deposit_ledger").select("id, amount, created_at").eq("related_payment_id", id),
    getSettings(),
  ]);
  const receiptViews = await signedReceipts(supabase, (receipts ?? []) as Receipt[]);

  return (
    <>
      <PageHeader
        title={`Квартира №${payment.apartments.apartment_number}`}
        description={`${payment.apartments.resident_surname}, ${periodLabel(payment.billing_periods).toLowerCase()}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/payments">До списку платежів</Link>
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Сума платежу" actions={<PaymentStatusBadge status={payment.status} />}>
            <ChargeBreakdown
              electricity={payment.electricity_amount}
              deposit={payment.deposit_contribution}
              hallLighting={payment.hall_lighting_amount}
              other={payment.other_amount}
              total={payment.total_amount}
            />
            <dl className="mt-3 border-t border-line pt-2 text-[15px]">
              <Row label="Дата подання" value={formatDateTime(payment.submitted_at)} />
              <Row label="Спроба" value={payment.attempt_no || "—"} />
              {payment.reviewed_at && <Row label={payment.status === "paid" ? "Підтверджено" : "Переглянуто"} value={formatDateTime(payment.reviewed_at)} />}
              {payment.confirmed_without_receipt && <Row label="Підтверджено без квитанції" value="Так" />}
              {payment.admin_note && <Row label="Примітка адміністратора" value={payment.admin_note} />}
              {(ledger ?? []).map((l) => (
                <Row key={l.id} label="Зараховано до депозиту" value={`${formatMoney(l.amount)}, ${formatDateTime(l.created_at)}`} />
              ))}
            </dl>
            {payment.status === "rejected" && payment.rejection_reason && (
              <Notice tone="danger" className="mt-3" title="Причина відхилення">{payment.rejection_reason}</Notice>
            )}
          </Panel>
          <Panel title="Рішення">
            <PaymentReview
              paymentId={payment.id}
              status={payment.status}
              hasReceipts={receiptViews.length > 0}
              total={String(payment.total_amount)}
            />
          </Panel>
        </div>
        <div className="flex flex-col gap-5">
          <Panel title="Квитанції">
            {receiptViews.length ? <ReceiptList receipts={receiptViews} /> : <p className="text-ink-soft">Квитанцію не завантажено</p>}
            {receiptViews[0]?.url && receiptViews[0].mime_type === "application/pdf" && (
              <iframe src={receiptViews[0].url} title="Перегляд квитанції" className="mt-3 h-96 w-full rounded-md border border-line" />
            )}
            {receiptViews[0]?.url && receiptViews[0].mime_type.startsWith("image/") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={receiptViews[0].url} alt="Перегляд квитанції" className="mt-3 max-h-[480px] w-full rounded-md border border-line object-contain" />
            )}
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-2 font-semibold">Завантажити квитанцію від імені мешканця</h3>
              <AddReceiptForm paymentId={payment.id} maxSizeMb={settings.max_receipt_size_mb} />
            </div>
          </Panel>
          <Panel title="Історія платежу">
            <ol className="flex flex-col gap-2 text-[15px]">
              {((events ?? []) as PaymentEvent[]).map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-line pb-2 last:border-0">
                  <span>
                    <span className="font-medium">{EVENT_LABEL[e.event_type]}</span>
                    {e.attempt_no > 0 && <span className="text-ink-soft">, спроба {e.attempt_no}</span>}
                    {e.reason && <span className="block text-ink-soft">{e.reason}</span>}
                    <span className="block text-sm text-ink-soft">Статус: {PAYMENT_STATUS_LABEL[e.status_after]}</span>
                  </span>
                  <span className="text-sm text-ink-soft">{formatDateTime(e.created_at)}</span>
                </li>
              ))}
            </ol>
          </Panel>
          <form action={enterViewAsAction}>
            <input type="hidden" name="apartmentId" value={payment.apartments.id} />
            <Button type="submit" variant="outline">Переглянути як мешканець</Button>
          </form>
        </div>
      </div>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getChargeDetailsAction, type ChargeDetails } from "@/app/actions/resident";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Notice, Row } from "@/components/ui/controls";
import { PaymentStatusBadge } from "@/components/ui/status";
import { ReceiptList } from "@/components/receipt-list";
import { AddReceiptForm } from "@/components/receipt-upload";
import { formatKwh, formatMoney, formatReading, formatTariff } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";

const EVENT_LABEL: Record<string, string> = {
  created: "Нарахування створено",
  amounts_updated: "Суми оновлено",
  submitted: "Надіслано на перевірку",
  receipt_added: "Додано квитанцію",
  approved: "Оплату підтверджено",
  rejected: "Оплату не отримано",
};

export function ChargeDialog({
  open,
  onOpenChange,
  apartmentId,
  periodId,
  maxSizeMb,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  apartmentId: string | null;
  periodId: string;
  maxSizeMb: number;
}) {
  const [details, setDetails] = useState<ChargeDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || !apartmentId) return;
    let cancelled = false;
    getChargeDetailsAction(apartmentId, periodId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setDetails(res.data!);
        setError(null);
      } else {
        setDetails(null);
        setError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, apartmentId, periodId, reloadKey]);

  const row = details?.row;
  const loading = open && !details && !error;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setDetails(null);
          setError(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent
        title={row ? `Квартира №${row.apartment_number}` : "Нарахування"}
        description={row ? `${row.resident_surname}, ${details!.periodLabel.toLowerCase()}` : undefined}
      >
        {loading && <p className="py-6 text-center text-ink-soft">Завантаження…</p>}
        {error && <Notice tone="danger">{error}</Notice>}
        {row && details && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">Статус платежу</span>
              <PaymentStatusBadge status={row.payment_status} />
            </div>
            <dl>
              <Row label="Попередній показник" value={row.has_reading ? formatReading(row.previous_reading) : "Не внесено"} />
              <Row label="Поточний показник" value={row.has_reading ? formatReading(row.current_reading) : "Не внесено"} />
              <Row label="Споживання" value={row.has_reading ? formatKwh(row.consumption_kwh) : "—"} />
              <Row label="Тариф" value={row.has_reading ? formatTariff(row.tariff_rate) : "—"} />
              <Row label="Вартість електроенергії" value={row.has_reading ? formatMoney(row.electricity_amount) : "—"} />
              <Row label="Депозит" value={formatMoney(row.deposit_contribution ?? 0)} />
              <Row label="Освітлення під'їзду" value={formatMoney(row.hall_lighting_amount ?? 0)} />
              <Row label="Інші внески" value={formatMoney(row.other_amount ?? 0)} />
              <Row label="Загальна сума" value={row.has_reading ? formatMoney(row.total_amount) : "—"} strong />
            </dl>
            <dl className="text-[15px]">
              <Row label="Дата подання" value={formatDateTime(row.submitted_at)} />
              {row.reviewed_at && <Row label="Дата підтвердження" value={formatDateTime(row.reviewed_at)} />}
            </dl>

            {details.privateInfo ? (
              <>
                {details.privateInfo.rejectionReason && row.payment_status === "rejected" && (
                  <Notice tone="danger" title="Причина відхилення">{details.privateInfo.rejectionReason}</Notice>
                )}
                {details.privateInfo.confirmedWithoutReceipt && (
                  <Notice tone="info">Підтверджено без квитанції{details.privateInfo.adminNote ? `: ${details.privateInfo.adminNote}` : ""}</Notice>
                )}
                <div>
                  <h3 className="mb-2 font-semibold">Квитанції</h3>
                  {details.privateInfo.receipts.length ? (
                    <ReceiptList receipts={details.privateInfo.receipts} />
                  ) : (
                    <p className="text-ink-soft">Квитанцію не завантажено</p>
                  )}
                </div>
                {row.payment_id && (details.isAdmin || row.payment_status === "pending_review") && (
                  <AddReceiptForm paymentId={row.payment_id} maxSizeMb={maxSizeMb} onDone={() => setReloadKey((k) => k + 1)} />
                )}
                {!details.isAdmin && (row.payment_status === "awaiting_payment" || row.payment_status === "rejected") && row.has_reading && (
                  <Link href="/pay" className="text-face underline underline-offset-4">
                    Оплатити та завантажити квитанцію
                  </Link>
                )}
                {details.isAdmin && row.payment_id && (
                  <Link href={`/admin/payments/${row.payment_id}`} className="text-face underline underline-offset-4">
                    Відкрити платіж в адмін-панелі
                  </Link>
                )}
                {details.privateInfo.events.length > 0 && (
                  <div>
                    <h3 className="mb-2 font-semibold">Історія</h3>
                    <ol className="flex flex-col gap-1 text-sm">
                      {details.privateInfo.events.map((e) => (
                        <li key={e.id} className="flex justify-between gap-3">
                          <span>
                            {EVENT_LABEL[e.event_type] ?? e.event_type}
                            {e.reason ? `: ${e.reason}` : ""}
                          </span>
                          <span className="whitespace-nowrap text-ink-soft">{formatDateTime(e.created_at)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[15px] text-ink-soft">
                {row.receipt_count > 0 ? "Квитанцію завантажено." : "Квитанцію не завантажено."} Квитанції інших квартир бачать лише мешканці
                цієї квартири та адміністратор.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { Tag } from "@/components/ui/status";
import { ReceiptList } from "@/components/receipt-list";
import { formatMoney } from "@/lib/money";
import { formatDateTime, periodLabel } from "@/lib/utils";
import type { DepositItem, DepositItemStatus, DepositTopupView, TopupStatus } from "@/lib/deposit-topups";

export const TOPUP_STATUS_LABEL: Record<TopupStatus, string> = {
  pending_review: "На перевірці",
  paid: "Зараховано",
  rejected: "Не підтверджено",
};

export function TopupStatusBadge({ status }: { status: TopupStatus }) {
  return <Tag tone={status === "paid" ? "ok" : status === "rejected" ? "danger" : "signal"}>{TOPUP_STATUS_LABEL[status]}</Tag>;
}

/** Список окремих внесків у депозит (для мешканця або адміністратора). */
export function TopupList({ items, showApartment, actions }: {
  items: DepositTopupView[];
  showApartment?: boolean;
  /** Дії адміністратора для внеску на перевірці */
  actions?: (t: DepositTopupView) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((t) => (
        <li key={t.id} className="rounded-[var(--radius-control)] border border-line p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="tabular text-lg font-bold">{formatMoney(t.amount)}</p>
              <p className="text-sm text-ink-soft">
                {showApartment && t.apartment_number ? `Кв. ${t.apartment_number}, ${t.resident_surname} · ` : ""}
                Подано {formatDateTime(t.created_at)}
                {t.status === "paid" && t.reviewed_at ? ` · зараховано ${formatDateTime(t.reviewed_at)}` : ""}
              </p>
            </div>
            <TopupStatusBadge status={t.status} />
          </div>
          {t.note && <p className="mt-2 text-[15px]">Примітка: {t.note}</p>}
          {t.status === "rejected" && t.rejection_reason && (
            <p className="mt-2 text-[15px] text-danger">Причина: {t.rejection_reason}</p>
          )}
          {t.receipts.length > 0 && (
            <div className="mt-3">
              <ReceiptList receipts={t.receipts} compact />
            </div>
          )}
          {actions && t.status === "pending_review" && <div className="mt-3">{actions(t)}</div>}
        </li>
      ))}
    </ul>
  );
}

const ITEM_STATUS: Record<DepositItemStatus, { label: string; tone: "ok" | "danger" | "signal" | "neutral" }> = {
  paid: { label: "Зараховано", tone: "ok" },
  pending_review: { label: "На перевірці", tone: "signal" },
  awaiting_payment: { label: "Очікує оплати", tone: "neutral" },
  rejected: { label: "Не підтверджено", tone: "danger" },
};

/** Усі внески квартири в депозит — з показниками й окремі — одним списком. */
export function DepositItemsList({ items }: { items: DepositItem[] }) {
  if (items.length === 0) return <p className="text-ink-soft">Внесків у депозит ще немає.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it) => {
        const st = ITEM_STATUS[it.status];
        return (
          <li key={it.key} className="rounded-[var(--radius-control)] border border-line p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="tabular text-lg font-bold">{formatMoney(it.amount)}</p>
                <p className="text-sm text-ink-soft">
                  {it.kind === "monthly" && it.period
                    ? `Разом із показниками за ${periodLabel(it.period).toLowerCase()}`
                    : `Окремий внесок, ${formatDateTime(it.date)}`}
                  {it.confirmedAt ? ` · зараховано ${formatDateTime(it.confirmedAt)}` : ""}
                </p>
              </div>
              <Tag tone={st.tone}>{st.label}</Tag>
            </div>
            {it.note && <p className="mt-2 text-[15px]">Примітка: {it.note}</p>}
            {it.status === "rejected" && it.rejectionReason && <p className="mt-2 text-[15px] text-danger">Причина: {it.rejectionReason}</p>}
            {it.status === "awaiting_payment" && (
              <p className="mt-2 text-sm text-ink-soft">Буде зараховано після підтвердження оплати за цей місяць.</p>
            )}
            {it.receipts.length > 0 && (
              <div className="mt-3">
                <ReceiptList receipts={it.receipts} compact />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

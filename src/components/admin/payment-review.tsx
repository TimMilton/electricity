"use client";

import { useState } from "react";
import { approvePaymentAction, rejectPaymentAction } from "@/app/actions/admin";
import { Button, Field, Notice, Textarea } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useAction } from "@/components/admin/use-action";
import { formatMoney } from "@/lib/money";
import type { PaymentStatus } from "@/lib/types";

export function PaymentReview({
  paymentId,
  status,
  hasReceipts,
  total,
}: {
  paymentId: string;
  status: PaymentStatus;
  hasReceipts: boolean;
  total: string;
}) {
  const { run } = useAction();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (status === "paid") {
    return <Notice tone="ok">Оплату підтверджено. Повторне підтвердження не змінить баланс депозиту.</Notice>;
  }

  return (
    <div className="flex flex-col gap-3">
      {!hasReceipts && (
        <Notice tone="warn">Квитанцію не завантажено. Для підтвердження без квитанції обов&apos;язкова примітка.</Notice>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <ConfirmDialog
          trigger={<Button variant="ok" size="lg">Підтвердити оплату</Button>}
          title="Підтвердити оплату?"
          description={`Сума ${formatMoney(total)}. Депозитний внесок буде зараховано до спільного балансу.`}
          confirmLabel="Підтвердити"
          tone="ok"
          onConfirm={async () => {
            if (!hasReceipts && note.trim().length < 3) {
              setLocalError("Додайте примітку: чому оплату підтверджено без квитанції");
              return false;
            }
            setLocalError(null);
            return run(() => approvePaymentAction({ paymentId, note: note.trim() || undefined }));
          }}
        >
          <Field
            label={hasReceipts ? "Примітка (необов'язково)" : "Примітка (обов'язково)"}
            htmlFor="approve-note"
            error={localError ?? undefined}
          >
            <Textarea id="approve-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={hasReceipts ? "" : "Напр.: оплачено готівкою"} />
          </Field>
        </ConfirmDialog>

        {status !== "rejected" && (
          <ConfirmDialog
            trigger={<Button variant="danger" size="lg">Відхилити</Button>}
            title="Відхилити платіж?"
            description="Мешканець побачить причину і зможе надіслати квитанцію повторно."
            confirmLabel="Відхилити"
            tone="danger"
            onConfirm={async () => {
              if (reason.trim().length < 3) {
                setLocalError("Вкажіть причину відхилення");
                return false;
              }
              setLocalError(null);
              return run(() => rejectPaymentAction({ paymentId, reason: reason.trim() }));
            }}
          >
            <Field label="Причина (обов'язково)" htmlFor="reject-reason" error={localError ?? undefined}>
              <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Напр.: кошти не надійшли на конверт" />
            </Field>
          </ConfirmDialog>
        )}
      </div>
    </div>
  );
}

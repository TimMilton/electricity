"use client";

import { useState } from "react";
import { approveDepositTopupAction, rejectDepositTopupAction } from "@/app/actions/admin";
import { Button, Field, Input, Textarea } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useAction } from "@/components/admin/use-action";
import { formatMoney } from "@/lib/money";

/** Підтвердити або відхилити окремий внесок у депозит. */
export function TopupReviewActions({ id, amount, apartment }: { id: string; amount: string; apartment: string }) {
  const { run } = useAction();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        trigger={<Button size="sm" variant="ok">Підтвердити</Button>}
        title={`Зарахувати ${formatMoney(amount)} до депозиту?`}
        description={`Кв. ${apartment}. Перевірте надходження на конверт. Запис у журналі депозиту буде незмінним.`}
        confirmLabel="Підтвердити й зарахувати"
        onConfirm={() => run(() => approveDepositTopupAction({ id, note: note || undefined }))}
      >
        <Field label="Примітка (необов'язково)" htmlFor={`tn-${id}`}>
          <Input id={`tn-${id}`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        trigger={<Button size="sm" variant="outline">Відхилити</Button>}
        title="Відхилити внесок?"
        description="Мешканець побачить причину й зможе подати новий внесок."
        confirmLabel="Відхилити"
        tone="danger"
        onConfirm={() => run(() => rejectDepositTopupAction({ id, reason }))}
      >
        <Field label="Причина (обов'язково)" htmlFor={`tr-${id}`}>
          <Textarea id={`tr-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Напр.: переказ не надійшов на конверт" />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteHouseReceiptAction, deleteReceiptAction } from "@/app/actions/admin";
import { Button, Field, Input, Notice } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useAction } from "@/components/admin/use-action";

/** Видалення квитанції адміністратором: з причиною, запис лишається в журналі змін. */
export function DeleteReceiptButton({
  receiptId,
  filename,
  onDeleted,
  kind = "payment",
}: {
  receiptId: string;
  filename: string;
  onDeleted?: () => void;
  /** payment — квитанція мешканця; house — квитанція будинку за загальним лічильником */
  kind?: "payment" | "house";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending, error, fieldErrors } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="text-danger" aria-label={`Видалити квитанцію ${filename}`}>
          <Trash2 aria-hidden />
          <span className="hidden sm:inline">Видалити</span>
        </Button>
      </DialogTrigger>
      <DialogContent title="Видалити квитанцію?">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => (kind === "house" ? deleteHouseReceiptAction : deleteReceiptAction)({ receiptId, reason }))) {
              setOpen(false);
              onDeleted?.();
            }
          }}
        >
          <p className="break-all text-[15px] font-medium">{filename}</p>
          <p className="text-sm text-ink-soft">
            {kind === "house"
              ? "Файл буде видалено назавжди, мешканці більше не бачитимуть цієї квитанції. Відомості про неї та причину видалення залишаться в журналі змін."
              : "Файл буде видалено назавжди. Платіж, його статус і суми не зміняться; відомості про квитанцію та причину видалення залишаться в журналі змін."}
          </p>
          <Field label="Причина (обов'язково)" htmlFor={`rd-${receiptId}`} error={fieldErrors.reason}>
            <Input id={`rd-${receiptId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Напр.: помилковий файл" />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" variant="danger" disabled={pending} className="self-start">
            {pending ? "Видаляємо…" : "Видалити квитанцію"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

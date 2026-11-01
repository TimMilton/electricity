"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addHouseReceiptsAction, prepareHouseReceiptUploadAction } from "@/app/actions/admin";
import { FilePicker, uploadFilesWith } from "@/components/receipt-upload";
import { Button, Field, Input, Notice } from "@/components/ui/controls";

/** Завантаження квитанції про оплату за загальним лічильником (адміністратор). */
export function HouseReceiptUploader({ periodId, maxSizeMb }: { periodId: string; maxSizeMb: number }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <FilePicker files={files} onChange={setFiles} maxSizeMb={maxSizeMb} id={`house-receipt-${periodId}`} />
      <Field label="Примітка (необов'язково)" htmlFor={`house-note-${periodId}`} hint="Напр.: оплачено постачальнику 07.11, 7 223,04 грн">
        <Input id={`house-note-${periodId}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button
        type="button"
        className="self-start"
        disabled={pending || files.length === 0}
        onClick={() =>
          start(async () => {
            setError(null);
            const up = await uploadFilesWith((described) => prepareHouseReceiptUploadAction(periodId, described), files);
            if (!up.ok) return setError(up.error);
            const res = await addHouseReceiptsAction({ periodId, uploads: up.uploads, note: note || undefined });
            if (!res.ok) return setError(res.error);
            toast.success(res.message ?? "Завантажено");
            setFiles([]);
            setNote("");
            router.refresh();
          })
        }
      >
        {pending ? "Завантажуємо…" : "Завантажити квитанцію будинку"}
      </Button>
    </div>
  );
}

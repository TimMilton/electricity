"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { prepareTopupUploadAction, submitDepositTopupAction } from "@/app/actions/resident";
import { FilePicker, uploadFilesWith } from "@/components/receipt-upload";
import { Button, Field, Input, Notice } from "@/components/ui/controls";
import { formatMoney, tryParseScaled } from "@/lib/money";

/** Окремий внесок у депозит: сума → переказ на конверт → квитанція → на перевірку. */
export function DepositTopupForm({ envelopeUrl, maxSizeMb, maxAmount }: { envelopeUrl: string | null; maxSizeMb: number; maxAmount: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const parsed = tryParseScaled(amount, 2);
  const max = tryParseScaled(maxAmount, 2);
  const amountError =
    amount.trim() === "" ? null : parsed === null || parsed <= 0n ? "Вкажіть суму, напр. 150 або 150,50" : max !== null && parsed > max ? `Не більше ${formatMoney(maxAmount)}` : null;
  const ready = parsed !== null && parsed > 0n && !amountError && files.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Field label="Сума внеску, грн" htmlFor="topup-amount" error={amountError ?? undefined}>
        <Input
          id="topup-amount"
          inputMode="decimal"
          autoComplete="off"
          className="tabular text-lg font-semibold sm:w-48"
          placeholder="150"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {envelopeUrl ? (
        <Button asChild variant="signal" className="self-start">
          <a href={envelopeUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden />
            Перейти до конверта
          </a>
        </Button>
      ) : (
        <Notice tone="warn">Посилання на конверт ще не налаштовано. Уточніть у адміністратора, куди переказати кошти.</Notice>
      )}
      <div>
        <p className="mb-2 text-sm font-medium">Квитанція або скріншот переказу</p>
        <FilePicker files={files} onChange={setFiles} maxSizeMb={maxSizeMb} id="topup-receipt" />
      </div>
      <Field label="Примітка (необов'язково)" htmlFor="topup-note">
        <Input id="topup-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button
        type="button"
        size="lg"
        className="sm:self-start"
        disabled={!ready || pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const up = await uploadFilesWith((described) => prepareTopupUploadAction(described), files);
            if (!up.ok) return setError(up.error);
            const res = await submitDepositTopupAction({ amount, uploads: up.uploads, note: note || undefined });
            if (!res.ok) return setError(res.error);
            toast.success(res.message ?? "Надіслано");
            setAmount("");
            setNote("");
            setFiles([]);
            router.refresh();
          })
        }
      >
        {pending ? "Надсилаємо…" : parsed && parsed > 0n && !amountError ? `Надіслати внесок ${formatMoney(amount.replace(",", "."))}` : "Надіслати внесок"}
      </Button>
      {!ready && !pending && <p className="text-sm text-ink-soft">Вкажіть суму і виберіть файл квитанції.</p>}
    </div>
  );
}

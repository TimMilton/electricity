"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { adminSubmitReadingAction } from "@/app/actions/admin";
import { Button, Field, Input, Notice } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useAction } from "@/components/admin/use-action";
import { formatReading } from "@/lib/money";

function plain(v: string | number | null | undefined) {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function AdminReadingEditor({
  apartmentId,
  periodId,
  number,
  hasReading,
  previous,
  current,
  deposit,
  hallLighting,
  other,
}: {
  apartmentId: string;
  periodId: string;
  number: string;
  hasReading: boolean;
  previous: string | number | null;
  current: string | number | null;
  deposit: string | number | null;
  hallLighting: string | number | null;
  other: string | number | null;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const { run, pending, error, fieldErrors } = useAction();
  const [f, setF] = useState({
    currentReading: plain(current),
    previousReading: "",
    deposit: plain(deposit),
    hallLighting: plain(hallLighting),
    other: plain(other),
    reason: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(ack: boolean) {
    const ok = await run(() => adminSubmitReadingAction({ apartmentId, periodId, ...f, acknowledgeDownstream: ack }), {
      onConfirm: (msg) => setConfirm(msg),
    });
    if (ok) {
      setConfirm(null);
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={hasReading ? "ghost" : "outline"} aria-label={`${hasReading ? "Виправити" : "Внести"} показник, кв. ${number}`}>
          <Pencil aria-hidden />
          {hasReading ? "Виправити" : "Внести"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`${hasReading ? "Виправлення" : "Внесення"} показника, кв. №${number}`}
        description="Дію буде записано в журнал змін від вашого імені."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          {previous !== null && <p className="text-[15px]">Попередній показник: <span className="tabular font-semibold">{formatReading(previous)}</span></p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Поточний показник" htmlFor="ar-cur" error={fieldErrors.currentReading}>
              <Input id="ar-cur" inputMode="decimal" value={f.currentReading} onChange={set("currentReading")} />
            </Field>
            <Field label="Інший попередній" htmlFor="ar-prev" hint="Лише при заміні лічильника" error={fieldErrors.previousReading}>
              <Input id="ar-prev" inputMode="decimal" value={f.previousReading} onChange={set("previousReading")} />
            </Field>
            <Field label="Депозит, грн" htmlFor="ar-dep" error={fieldErrors.deposit}>
              <Input id="ar-dep" inputMode="decimal" value={f.deposit} onChange={set("deposit")} />
            </Field>
            <Field label="Освітлення, грн" htmlFor="ar-hall" error={fieldErrors.hallLighting}>
              <Input id="ar-hall" inputMode="decimal" value={f.hallLighting} onChange={set("hallLighting")} />
            </Field>
            <Field label="Інші, грн" htmlFor="ar-other" error={fieldErrors.other}>
              <Input id="ar-other" inputMode="decimal" value={f.other} onChange={set("other")} />
            </Field>
          </div>
          <Field label={hasReading ? "Причина виправлення (обов'язково)" : "Причина"} htmlFor="ar-reason" error={fieldErrors.reason}>
            <Input id="ar-reason" value={f.reason} onChange={set("reason")} />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          {confirm && (
            <Notice tone="warn" title="Потрібне підтвердження">
              {confirm}
              <div className="mt-2">
                <Button type="button" size="sm" disabled={pending} onClick={() => submit(true)}>
                  Підтвердити виправлення
                </Button>
              </div>
            </Notice>
          )}
          <Button type="submit" disabled={pending}>{pending ? "Зберігаємо…" : "Зберегти"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

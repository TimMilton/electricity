"use client";

import { useState } from "react";
import {
  closePeriodAction,
  createNextPeriodAction,
  createPeriodAction,
  deleteFutureTariffAction,
  reopenPeriodAction,
  setTariffAction,
  updatePeriodAction,
} from "@/app/actions/admin";
import { Button, Checkbox, Field, Input, Notice, Select } from "@/components/ui/controls";
import { ConfirmDialog, Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useAction } from "@/components/admin/use-action";
import { MONTHS } from "@/lib/utils";

export function CreatePeriodForm({ defaults }: { defaults: { year: number; month: number; windowStart: string; windowEnd: string } }) {
  const { run, pending, error, fieldErrors } = useAction();
  const [f, setF] = useState({ ...defaults, allowAdminEditAfterClose: true });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createPeriodAction(f));
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Місяць показників" htmlFor="np-month">
          <Select id="np-month" value={f.month} onChange={(e) => setF({ ...f, month: Number(e.target.value) })}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Рік" htmlFor="np-year">
          <Input id="np-year" type="number" min={2000} max={2100} value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })} />
        </Field>
        <Field label="Відкриття приймання" htmlFor="np-start">
          <Input id="np-start" type="datetime-local" value={f.windowStart} onChange={(e) => setF({ ...f, windowStart: e.target.value })} />
        </Field>
        <Field label="Закриття приймання" htmlFor="np-end" error={fieldErrors.windowEnd}>
          <Input id="np-end" type="datetime-local" value={f.windowEnd} onChange={(e) => setF({ ...f, windowEnd: e.target.value })} />
        </Field>
      </div>
      <Checkbox
        label="Дозволити адміністративне виправлення після закриття"
        checked={f.allowAdminEditAfterClose}
        onChange={(e) => setF({ ...f, allowAdminEditAfterClose: e.target.checked })}
      />
      <p className="text-sm text-ink-soft">Час — за Києвом.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>Створити період</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => createNextPeriodAction())}>
          Наступний за типовими датами
        </Button>
      </div>
    </form>
  );
}

export function PeriodEditor({
  periodId,
  label,
  windowStart,
  windowEnd,
  allowAdminEditAfterClose,
  closed,
}: {
  periodId: string;
  label: string;
  windowStart: string;
  windowEnd: string;
  allowAdminEditAfterClose: boolean;
  closed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useAction();
  const [f, setF] = useState({ windowStart, windowEnd, allowAdminEditAfterClose, reason: "" });
  const [reopenEnd, setReopenEnd] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Керувати</Button>
      </DialogTrigger>
      <DialogContent title={label}>
        <div className="flex flex-col gap-5">
          {!closed && (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => updatePeriodAction({ periodId, ...f }))) setOpen(false);
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Відкриття" htmlFor={`ws-${periodId}`}>
                  <Input id={`ws-${periodId}`} type="datetime-local" value={f.windowStart} onChange={(e) => setF({ ...f, windowStart: e.target.value })} />
                </Field>
                <Field label="Закриття" htmlFor={`we-${periodId}`}>
                  <Input id={`we-${periodId}`} type="datetime-local" value={f.windowEnd} onChange={(e) => setF({ ...f, windowEnd: e.target.value })} />
                </Field>
              </div>
              <Checkbox
                label="Дозволити адміністративне виправлення після закриття"
                checked={f.allowAdminEditAfterClose}
                onChange={(e) => setF({ ...f, allowAdminEditAfterClose: e.target.checked })}
              />
              <Field label="Причина зміни" htmlFor={`wr-${periodId}`}>
                <Input id={`wr-${periodId}`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              </Field>
              <Button type="submit" disabled={pending} className="self-start">Зберегти дати</Button>
            </form>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {!closed ? (
            <ConfirmDialog
              trigger={<Button variant="danger" className="self-start">Закрити приймання зараз</Button>}
              title="Закрити приймання показників?"
              description="Мешканці більше не зможуть вносити або змінювати показники за цей місяць."
              confirmLabel="Закрити"
              tone="danger"
              onConfirm={async () => {
                const ok = await run(() => closePeriodAction({ periodId, reason: f.reason }));
                if (ok) setOpen(false);
                return ok;
              }}
            />
          ) : (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <h3 className="font-semibold">Відкрити повторно</h3>
              <Field label="Нова дата закриття" htmlFor={`re-${periodId}`}>
                <Input id={`re-${periodId}`} type="datetime-local" value={reopenEnd} onChange={(e) => setReopenEnd(e.target.value)} />
              </Field>
              <Field label="Причина (обов'язково)" htmlFor={`rr-${periodId}`}>
                <Input id={`rr-${periodId}`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              </Field>
              <Button
                variant="outline"
                className="self-start"
                disabled={pending || !reopenEnd}
                onClick={async () => {
                  if (await run(() => reopenPeriodAction({ periodId, windowEnd: reopenEnd, reason: f.reason }))) setOpen(false);
                }}
              >
                Відкрити приймання
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TariffForm({ today }: { today: string }) {
  const { run, pending, error, fieldErrors } = useAction();
  const [f, setF] = useState({ rate: "", validFrom: today, reason: "" });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setTariffAction(f), { onSuccess: () => setF({ ...f, rate: "", reason: "" }) });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Тариф, грн за кВт·год" htmlFor="tf-rate" error={fieldErrors.rate}>
          <Input id="tf-rate" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        </Field>
        <Field label="Діє з" htmlFor="tf-from" error={fieldErrors.validFrom}>
          <Input id="tf-from" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
        </Field>
      </div>
      <Field label="Підстава" htmlFor="tf-reason" hint="Напр.: постанова НКРЕКП">
        <Input id="tf-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      <p className="text-sm text-ink-soft">
        Тариф застосовується до періодів, що починаються з цієї дати. Уже внесені нарахування не перераховуються.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" disabled={pending} className="self-start">Встановити тариф</Button>
    </form>
  );
}

export function DeleteTariffButton({ tariffId }: { tariffId: string }) {
  const { run } = useAction();
  return (
    <ConfirmDialog
      trigger={<Button size="sm" variant="ghost">Видалити</Button>}
      title="Видалити майбутній тариф?"
      confirmLabel="Видалити"
      tone="danger"
      onConfirm={() => run(() => deleteFutureTariffAction({ tariffId }))}
    />
  );
}

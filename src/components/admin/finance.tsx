"use client";

import { useState } from "react";
import {
  applyAdjustmentAction,
  closeReconciliationAction,
  depositOperationAction,
  recalculateReconciliationAction,
  reviewReconciliationAction,
  saveCommonReadingAction,
  deleteCommonReadingAction,
} from "@/app/actions/admin";
import { Trash2 } from "lucide-react";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useAction } from "@/components/admin/use-action";
import { formatMoney } from "@/lib/money";
import type { ReconciliationStatus } from "@/lib/types";

export function CommonReadingForm({
  periodId,
  existing,
  suggestedPrevious,
  depositUsed,
}: {
  periodId: string;
  existing: { previous: string; current: string; notes: string | null } | null;
  suggestedPrevious: string | null;
  /** Скільки вже використано з депозиту на розбіжність цього місяця */
  depositUsed?: string | null;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [f, setF] = useState({
    previousReading: existing?.previous ?? suggestedPrevious ?? "",
    currentReading: existing?.current ?? "",
    notes: existing?.notes ?? "",
    reason: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  function save(acknowledge: boolean) {
    return run(
      () =>
        saveCommonReadingAction({
          periodId,
          currentReading: f.currentReading,
          previousReading: f.previousReading || undefined,
          notes: f.notes || undefined,
          reason: f.reason || undefined,
          acknowledge,
        }),
      {
        onConfirm: (msg) => setConfirm(msg),
        onSuccess: () => {
          setConfirm(null);
          setF((s) => ({ ...s, reason: "" }));
        },
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      {existing && depositUsed && Number(depositUsed) > 0 && (
        <Notice tone="warn">
          За розбіжність цього місяця з депозиту вже використано {formatMoney(depositUsed)}. Виправити показник можна, але записи
          депозиту не зміняться — за потреби зробіть коригування в розділі «Депозит».
        </Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Попередній показник"
          htmlFor="cm-prev"
          hint={suggestedPrevious && !existing ? "Підставлено з попереднього місяця" : undefined}
          error={fieldErrors.previousReading}
        >
          <Input id="cm-prev" inputMode="decimal" className="tabular" value={f.previousReading} onChange={set("previousReading")} />
        </Field>
        <Field label="Поточний показник" htmlFor="cm-cur" error={fieldErrors.currentReading}>
          <Input id="cm-cur" inputMode="decimal" className="tabular text-lg font-semibold" value={f.currentReading} onChange={set("currentReading")} />
        </Field>
      </div>
      <Field label="Примітка" htmlFor="cm-notes">
        <Textarea id="cm-notes" value={f.notes} onChange={set("notes")} />
      </Field>
      {existing && (
        <Field
          label="Причина виправлення (обов'язково)"
          htmlFor="cm-reason"
          hint="Буде записано в журнал змін разом зі старими значеннями"
          error={fieldErrors.reason}
        >
          <Input id="cm-reason" value={f.reason} onChange={set("reason")} />
        </Field>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {confirm && (
        <Notice tone="warn" title="Потрібне підтвердження">
          <p>{confirm}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => save(true)}>
              Підтвердити виправлення
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
              Скасувати
            </Button>
          </div>
        </Notice>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Зберігаємо…" : existing ? "Зберегти виправлення" : "Зберегти показник"}
      </Button>
    </form>
  );
}

export function DeleteCommonReadingButton({
  periodId,
  periodLabel,
  depositUsed,
}: {
  periodId: string;
  periodLabel: string;
  depositUsed?: string | null;
}) {
  const { run } = useAction();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const blocked = Boolean(depositUsed && Number(depositUsed) > 0);

  if (blocked) {
    return (
      <p className="text-sm text-ink-soft">
        Видалити показник неможливо: за розбіжність цього місяця вже використано кошти депозиту. Виправте показник у формі вище.
      </p>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="outline" className="self-start text-danger">
          <Trash2 aria-hidden />
          Видалити показник
        </Button>
      }
      title={`Видалити показник за ${periodLabel.toLowerCase()}?`}
      description="Буде видалено показник загального лічильника і розрахунок розбіжності за цей місяць. Запис про видалення залишиться в журналі змін."
      confirmLabel="Видалити"
      tone="danger"
      onConfirm={async () => {
        if (reason.trim().length < 3) {
          setLocalError("Вкажіть причину видалення");
          return false;
        }
        setLocalError(null);
        const ok = await run(() => deleteCommonReadingAction({ periodId, reason: reason.trim() }));
        if (ok) setReason("");
        return ok;
      }}
    >
      <Field label="Причина (обов'язково)" htmlFor={`del-cm-${periodId}`} error={localError ?? undefined}>
        <Input id={`del-cm-${periodId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Напр.: внесено не за той місяць" />
      </Field>
    </ConfirmDialog>
  );
}

export function ReconciliationActions({
  id,
  periodId,
  status,
  discrepancyPositive,
  needsExplanation,
  estimated,
  balance,
}: {
  id: string;
  periodId: string;
  status: ReconciliationStatus;
  discrepancyPositive: boolean;
  needsExplanation: boolean;
  estimated: string | null;
  balance: string;
}) {
  const { run } = useAction();
  const [explanation, setExplanation] = useState("");
  const [amount, setAmount] = useState(estimated && Number(estimated) > 0 ? estimated : "");
  const [description, setDescription] = useState("");

  return (
    <div className="flex flex-wrap gap-2">
      {status === "calculated" && (
        <>
          <Button variant="outline" onClick={() => run(() => recalculateReconciliationAction(periodId))}>
            Перерахувати
          </Button>
          <ConfirmDialog
            trigger={<Button>Позначити перевіреною</Button>}
            title="Розбіжність перевірено?"
            description={needsExplanation ? "Дані неповні або розбіжність від'ємна — додайте пояснення." : "Після перевірки можна використати депозит."}
            confirmLabel="Позначити перевіреною"
            onConfirm={() => run(() => reviewReconciliationAction({ id, explanation }))}
          >
            <Field label={needsExplanation ? "Пояснення (обов'язково)" : "Пояснення"} htmlFor={`exp-${id}`}>
              <Textarea id={`exp-${id}`} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
            </Field>
          </ConfirmDialog>
        </>
      )}
      {(status === "reviewed" || status === "adjustment_applied") && discrepancyPositive && (
        <ConfirmDialog
          trigger={<Button variant="signal">Використати депозит</Button>}
          title="Використати кошти депозиту"
          description={`Доступно на депозиті: ${formatMoney(balance)}. Операцію буде записано в незмінний журнал.`}
          confirmLabel="Списати з депозиту"
          tone="danger"
          onConfirm={() => run(() => applyAdjustmentAction({ reconciliationId: id, amount, description }))}
        >
          <div className="flex flex-col gap-3">
            <Field label="Сума, грн" htmlFor={`adj-${id}`} hint={estimated ? `Орієнтовна вартість розбіжності: ${formatMoney(estimated)}` : undefined}>
              <Input id={`adj-${id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Підстава (обов'язково)" htmlFor={`adjd-${id}`}>
              <Textarea id={`adjd-${id}`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Напр.: доплата обленерго за рахунком №…" />
            </Field>
          </div>
        </ConfirmDialog>
      )}
      {status !== "calculated" && status !== "closed" && (
        <ConfirmDialog
          trigger={<Button variant="outline">Закрити розбіжність</Button>}
          title="Закрити розбіжність?"
          description="Після закриття перерахунок і зміни показника загального лічильника за цей місяць будуть недоступні."
          confirmLabel="Закрити"
          onConfirm={() => run(() => closeReconciliationAction({ id, explanation }))}
        >
          <Field label="Коментар" htmlFor={`cl-${id}`}>
            <Textarea id={`cl-${id}`} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
    </div>
  );
}

export function DepositOperationForm({
  periods,
  apartments,
  defaultPeriodId,
}: {
  periods: { id: string; label: string }[];
  apartments: { id: string; label: string }[];
  defaultPeriodId?: string;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [f, setF] = useState({ type: "correction" as "correction" | "refund", amount: "", description: "", periodId: defaultPeriodId ?? periods[0]?.id ?? "", apartmentId: "" });
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Тип операції" htmlFor="op-type">
          <Select id="op-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as typeof f.type })}>
            <option value="correction">Коригування (+ або −)</option>
            <option value="refund">Повернення коштів</option>
          </Select>
        </Field>
        <Field
          label="Сума, грн"
          htmlFor="op-amount"
          hint={f.type === "correction" ? "Від'ємна сума зменшує баланс" : "Додатна сума, буде списана з депозиту"}
          error={fieldErrors.amount}
        >
          <Input id="op-amount" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Період" htmlFor="op-period">
          <Select id="op-period" value={f.periodId} onChange={(e) => setF({ ...f, periodId: e.target.value })}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Квартира (необов'язково)" htmlFor="op-apt">
          <Select id="op-apt" value={f.apartmentId} onChange={(e) => setF({ ...f, apartmentId: e.target.value })}>
            <option value="">Не стосується квартири</option>
            {apartments.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Підстава (обов'язково)" htmlFor="op-desc" error={fieldErrors.description}>
        <Textarea id="op-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <ConfirmDialog
        trigger={<Button type="button" disabled={pending} className="self-start">Записати операцію</Button>}
        title="Записати операцію з депозитом?"
        description="Запис у журналі депозиту не можна змінити чи видалити — помилку виправляють новим коригуванням."
        confirmLabel="Записати"
        onConfirm={() =>
          run(
            () =>
              depositOperationAction({
                type: f.type,
                amount: f.amount,
                description: f.description,
                periodId: f.periodId,
                apartmentId: f.apartmentId || undefined,
              }),
            { onSuccess: () => setF((s) => ({ ...s, amount: "", description: "" })) },
          )
        }
      />
    </form>
  );
}

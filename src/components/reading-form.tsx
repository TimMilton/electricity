"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { submitReadingAction } from "@/app/actions/resident";
import { Button, Field, Input, Notice, Panel, Textarea } from "@/components/ui/controls";
import { ChargeBreakdown } from "@/components/charges";
import { calculateCharge, formatKwh, formatReading, formatTariff, tryParseScaled } from "@/lib/money";

const decimal = (label: string, scale: number, required: boolean) =>
  z
    .string()
    .trim()
    .refine((v) => (required ? v !== "" : true), `Вкажіть: ${label.toLowerCase()}`)
    .refine((v) => v === "" || new RegExp(`^\\d+([.,]\\d{1,${scale}})?$`).test(v), `${label}: невід'ємне число, до ${scale} знаків після коми`);

export type ReadingFormProps = {
  periodId: string;
  periodLabel: string;
  previous: string | null;
  previousCaption: string | null;
  tariff: string | null;
  initial: { current: string; deposit: string; hallLighting: string; other: string };
  otherEnabled: boolean;
  maxContribution: string;
  isAdmin: boolean;
  hasExisting: boolean;
};

export function ReadingForm(props: ReadingFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const needsPrevious = props.previous === null;

  const schema = z.object({
    current: decimal("Поточний показник", 2, true),
    previous: decimal("Попередній показник", 2, needsPrevious),
    deposit: decimal("Депозит", 2, false),
    hallLighting: decimal("Освітлення під'їзду", 2, false),
    other: decimal("Інші внески", 2, false),
    reason: z.string().trim().max(1000).refine((v) => !(props.isAdmin && props.hasExisting) || v.length >= 3, "Вкажіть причину виправлення"),
    notes: z.string().trim().max(1000),
  });
  type Values = z.infer<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      current: props.initial.current,
      previous: "",
      deposit: props.initial.deposit,
      hallLighting: props.initial.hallLighting,
      other: props.initial.other,
      reason: "",
      notes: "",
    },
  });
  const values = useWatch({ control: form.control });
  const effectivePrevious = (props.isAdmin && values.previous) || props.previous || values.previous || "";

  const calc =
    values.current && effectivePrevious && props.tariff
      ? calculateCharge({
          previous: effectivePrevious,
          current: values.current,
          tariff: props.tariff,
          deposit: values.deposit || "0",
          hallLighting: values.hallLighting || "0",
          other: values.other || "0",
        })
      : null;

  const maxContribution = tryParseScaled(props.maxContribution, 2);
  const overLimit = (v?: string) => {
    const p = tryParseScaled(v ?? "", 2);
    return p !== null && maxContribution !== null && p > maxContribution;
  };

  function submit(data: Values, acknowledge = false) {
    setServerError(null);
    startTransition(async () => {
      const res = await submitReadingAction({
        periodId: props.periodId,
        currentReading: data.current,
        previousReading: data.previous || undefined,
        deposit: data.deposit,
        hallLighting: data.hallLighting,
        other: props.otherEnabled ? data.other : "0",
        notes: data.notes || undefined,
        reason: data.reason || undefined,
        acknowledgeDownstream: acknowledge,
      });
      if (!res.ok) {
        if (res.needsConfirmation) {
          setConfirmText(res.error);
          return;
        }
        setServerError(res.error);
        if (res.fieldErrors) {
          const map: Record<string, keyof Values> = {
            currentReading: "current", previousReading: "previous", deposit: "deposit", hallLighting: "hallLighting", other: "other",
          };
          for (const [k, msg] of Object.entries(res.fieldErrors)) {
            const f = map[k];
            if (f) form.setError(f, { message: msg });
          }
        }
        return;
      }
      setConfirmText(null);
      setWarnings(res.warnings ?? []);
      toast.success("Показники збережено");
      if (!res.warnings?.length) router.push("/home");
      else router.refresh();
    });
  }

  const err = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((d) => submit(d))} className="flex flex-col gap-5" noValidate>
      <Panel title={`Показник лічильника за ${props.periodLabel.toLowerCase()}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Попередній показник</span>
            {props.previous !== null ? (
              <>
                <span className="tabular flex h-11 items-center rounded-[var(--radius-control)] bg-casing px-3 font-semibold">
                  {formatReading(props.previous)}
                </span>
                {props.previousCaption && <span className="text-sm text-ink-soft">{props.previousCaption}</span>}
              </>
            ) : (
              <span className="text-sm text-ink-soft">Історії показників ще немає — вкажіть показник на початок обліку нижче.</span>
            )}
          </div>
          <Field label="Поточний показник, кВт·год" htmlFor="current" error={err.current?.message}>
            <Input
              id="current"
              inputMode="decimal"
              autoComplete="off"
              className="tabular text-lg font-semibold"
              aria-invalid={!!err.current}
              {...form.register("current")}
            />
          </Field>
          {(needsPrevious || props.isAdmin) && (
            <Field
              label={needsPrevious ? "Показник на початок обліку, кВт·год" : "Змінити попередній показник (заміна лічильника)"}
              htmlFor="previous"
              hint={props.isAdmin && !needsPrevious ? "Залиште порожнім, щоб використати зафіксований показник" : undefined}
              error={err.previous?.message}
            >
              <Input id="previous" inputMode="decimal" autoComplete="off" className="tabular" aria-invalid={!!err.previous} {...form.register("previous")} />
            </Field>
          )}
        </div>
      </Panel>

      <Panel title="Додаткові внески" description="Суму кожного внеску ви визначаєте самостійно. Можна вказати 0.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Депозит на покриття можливих розбіжностей, грн"
            htmlFor="deposit"
            hint={overLimit(values.deposit) ? undefined : "Зараховується до депозиту будинку після підтвердження оплати"}
            error={err.deposit?.message ?? (overLimit(values.deposit) ? "Перевищує допустиму суму внеску" : undefined)}
          >
            <Input id="deposit" inputMode="decimal" autoComplete="off" className="tabular" placeholder="0" {...form.register("deposit")} />
          </Field>
          <Field
            label="Освітлення під'їзду, грн"
            htmlFor="hallLighting"
            error={err.hallLighting?.message ?? (overLimit(values.hallLighting) ? "Перевищує допустиму суму внеску" : undefined)}
          >
            <Input id="hallLighting" inputMode="decimal" autoComplete="off" className="tabular" placeholder="0" {...form.register("hallLighting")} />
          </Field>
          {props.otherEnabled && (
            <Field label="Інші внески, грн" htmlFor="other" error={err.other?.message}>
              <Input id="other" inputMode="decimal" autoComplete="off" className="tabular" placeholder="0" {...form.register("other")} />
            </Field>
          )}
        </div>
      </Panel>

      <Panel title="Розрахунок" id="calc" description={props.tariff ? `Тариф: ${formatTariff(props.tariff)}` : undefined}>
        {!props.tariff ? (
          <Notice tone="warn">Тариф для цього періоду не визначено. Зверніться до адміністратора.</Notice>
        ) : calc === null ? (
          <p className="text-ink-soft">Введіть поточний показник, щоб побачити суму.</p>
        ) : calc.ok ? (
          <>
            <p className="mb-3 text-[15px]">
              Споживання: <span className="tabular font-semibold">{formatKwh(calc.value.consumption)}</span>
            </p>
            <ChargeBreakdown
              electricity={calc.value.electricity}
              deposit={calc.value.deposit}
              hallLighting={calc.value.hallLighting}
              other={calc.value.other}
              total={calc.value.total}
              showOther={props.otherEnabled}
            />
            <p className="mt-3 text-sm text-ink-soft">Остаточну суму розраховує й зберігає сервер після надсилання.</p>
          </>
        ) : (
          <Notice tone="danger">{calc.error}</Notice>
        )}
      </Panel>

      {props.isAdmin && (
        <Panel title="Дані адміністратора">
          <div className="grid gap-4">
            <Field
              label={props.hasExisting ? "Причина виправлення" : "Причина (необов'язково)"}
              htmlFor="reason"
              error={err.reason?.message}
            >
              <Input id="reason" {...form.register("reason")} />
            </Field>
            <Field label="Примітка до показника" htmlFor="notes">
              <Textarea id="notes" {...form.register("notes")} />
            </Field>
          </div>
        </Panel>
      )}

      {serverError && <Notice tone="danger">{serverError}</Notice>}
      {warnings.length > 0 && (
        <Notice tone="warn" title="Збережено з попередженнями">
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      {confirmText && (
        <Notice tone="warn" title="Потрібне підтвердження">
          <p>{confirmText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="primary" disabled={pending} onClick={form.handleSubmit((d) => submit(d, true))}>
              Підтвердити виправлення
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmText(null)}>
              Скасувати
            </Button>
          </div>
        </Notice>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" size="lg" disabled={pending || (calc !== null && !calc.ok)}>
          {pending ? "Зберігаємо…" : props.hasExisting ? "Зберегти зміни" : "Надіслати показники"}
        </Button>
      </div>
    </form>
  );
}

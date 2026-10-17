"use client";

import { useState } from "react";
import { saveSettingsAction } from "@/app/actions/admin";
import { Button, Checkbox, Field, Input, Notice, Panel, Textarea } from "@/components/ui/controls";
import { useAction } from "@/components/admin/use-action";
import { ALL_RECEIPT_MIME, MIME_LABEL } from "@/lib/files";
import type { AppSettings } from "@/lib/types";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const { run, pending, error, fieldErrors } = useAction();
  const [s, setS] = useState({
    envelope_url: settings.envelope_url ?? "",
    max_receipt_size_mb: settings.max_receipt_size_mb,
    allowed_receipt_mime_types: settings.allowed_receipt_mime_types,
    show_deposit_balance_to_residents: settings.show_deposit_balance_to_residents,
    other_charges_enabled: settings.other_charges_enabled,
    max_contribution_amount: String(settings.max_contribution_amount),
    registration_open: settings.registration_open,
    registration_code_required: settings.registration_code_required,
    registration_code_max_attempts: settings.registration_code_max_attempts,
    registration_lockout_minutes: settings.registration_lockout_minutes,
    default_window_start_day: settings.default_window_start_day,
    default_window_start_hour: settings.default_window_start_hour,
    default_window_end_day: settings.default_window_end_day,
    default_window_end_hour: settings.default_window_end_hour,
    window_for_previous_month: settings.window_for_previous_month,
    admin_edit_after_close: settings.admin_edit_after_close,
    anomaly_threshold_kwh: settings.anomaly_threshold_kwh == null ? "" : String(settings.anomaly_threshold_kwh),
    anomaly_multiplier: settings.anomaly_multiplier == null ? "" : String(settings.anomaly_multiplier),
    deposit_public_note: settings.deposit_public_note ?? "",
  });
  const [reason, setReason] = useState("");
  type K = keyof typeof s;
  const text = (k: K) => ({ value: String(s[k]), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value }) });
  const num = (k: K) => ({ type: "number", value: String(s[k]), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) }) });
  const bool = (k: K) => ({ checked: Boolean(s[k]), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.checked }) });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveSettingsAction(s, reason));
      }}
    >
      <Panel title="Оплата">
        <div className="flex flex-col gap-4">
          <Field label="Посилання на спільний конверт" htmlFor="st-env" hint="Напр.: посилання на банку Monobank. Лише https." error={fieldErrors.envelope_url}>
            <Input id="st-env" type="url" placeholder="https://" {...text("envelope_url")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Максимальний розмір квитанції, МБ" htmlFor="st-size" error={fieldErrors.max_receipt_size_mb}>
              <Input id="st-size" min={1} max={50} {...num("max_receipt_size_mb")} />
            </Field>
            <Field label="Ліміт одного внеску, грн" htmlFor="st-max" error={fieldErrors.max_contribution_amount}>
              <Input id="st-max" inputMode="decimal" {...text("max_contribution_amount")} />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Дозволені формати квитанцій</legend>
            <div className="flex flex-wrap gap-4">
              {ALL_RECEIPT_MIME.map((m) => (
                <Checkbox
                  key={m}
                  label={MIME_LABEL[m]}
                  checked={s.allowed_receipt_mime_types.includes(m)}
                  onChange={(e) =>
                    setS({
                      ...s,
                      allowed_receipt_mime_types: e.target.checked
                        ? [...s.allowed_receipt_mime_types, m]
                        : s.allowed_receipt_mime_types.filter((x) => x !== m),
                    })
                  }
                />
              ))}
            </div>
            {fieldErrors.allowed_receipt_mime_types && <p className="mt-1 text-sm text-danger">{fieldErrors.allowed_receipt_mime_types}</p>}
          </fieldset>
          <Checkbox label="Дозволити поле «Інші внески»" {...bool("other_charges_enabled")} />
        </div>
      </Panel>

      <Panel title="Приймання показників" description="Типові дати для нових періодів (за Києвом). Наявні періоди змінюються на сторінці періодів.">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="День відкриття" htmlFor="st-sd" error={fieldErrors.default_window_start_day}>
            <Input id="st-sd" min={1} max={28} {...num("default_window_start_day")} />
          </Field>
          <Field label="Година відкриття" htmlFor="st-sh">
            <Input id="st-sh" min={0} max={23} {...num("default_window_start_hour")} />
          </Field>
          <Field label="День закриття" htmlFor="st-ed" error={fieldErrors.default_window_end_day}>
            <Input id="st-ed" min={1} max={28} {...num("default_window_end_day")} />
          </Field>
          <Field label="Година закриття" htmlFor="st-eh">
            <Input id="st-eh" min={0} max={23} {...num("default_window_end_hour")} />
          </Field>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <Checkbox label="Вікно на початку місяця приймає показники за попередній місяць" {...bool("window_for_previous_month")} />
          <Checkbox label="Дозволяти адміністративне виправлення після закриття (типово для нових періодів)" {...bool("admin_edit_after_close")} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Поріг аномального споживання, кВт·год" htmlFor="st-at" hint="Порожньо — не перевіряти" error={fieldErrors.anomaly_threshold_kwh}>
            <Input id="st-at" inputMode="decimal" {...text("anomaly_threshold_kwh")} />
          </Field>
          <Field label="Перевищення середнього, разів" htmlFor="st-am" hint="Напр. 2 — удвічі більше за середнє за 3 місяці" error={fieldErrors.anomaly_multiplier}>
            <Input id="st-am" inputMode="decimal" {...text("anomaly_multiplier")} />
          </Field>
        </div>
      </Panel>

      <Panel title="Реєстрація">
        <div className="flex flex-col gap-3">
          <Checkbox label="Самостійна реєстрація відкрита" {...bool("registration_open")} />
          <Checkbox label="Вимагати одноразовий код квартири (рекомендовано)" {...bool("registration_code_required")} />
        </div>
        {!s.registration_code_required && (
          <Notice tone="warn" className="mt-3">Без коду квартиру підтверджують лише номер і прізвище — ці дані можуть знати сторонні.</Notice>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Спроб до блокування" htmlFor="st-ma">
            <Input id="st-ma" min={1} max={50} {...num("registration_code_max_attempts")} />
          </Field>
          <Field label="Тривалість блокування, хв" htmlFor="st-lm">
            <Input id="st-lm" min={1} {...num("registration_lockout_minutes")} />
          </Field>
        </div>
      </Panel>

      <Panel title="Депозит">
        <Checkbox label="Показувати мешканцям баланс і використання депозиту будинку" {...bool("show_deposit_balance_to_residents")} />
        <Field label="Пояснення для мешканців" htmlFor="st-note" className="mt-4">
          <Textarea id="st-note" {...text("deposit_public_note")} />
        </Field>
      </Panel>

      <Panel>
        <Field label="Причина змін (для журналу)" htmlFor="st-reason">
          <Input id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
        <Button type="submit" size="lg" disabled={pending} className="mt-4">
          {pending ? "Зберігаємо…" : "Зберегти налаштування"}
        </Button>
      </Panel>
    </form>
  );
}

"use client";

import { useState } from "react";
import { Copy, KeyRound, Pencil, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  generateCodeAction,
  generateCodesBulkAction,
  importApartmentsAction,
  saveApartmentAction,
  setUserActiveAction,
  setUserRoleAction,
} from "@/app/actions/admin";
import { Button, Checkbox, Field, Input, Notice, Textarea } from "@/components/ui/controls";
import { ConfirmDialog, Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useAction } from "@/components/admin/use-action";

export type ApartmentRow = {
  id: string;
  apartment_number: string;
  resident_surname: string;
  is_active: boolean;
  initial_reading: number | string | null;
  initial_reading_date: string | null;
};

export function ApartmentEditor({ apartment }: { apartment?: ApartmentRow }) {
  const [open, setOpen] = useState(false);
  const { run, pending, fieldErrors, error } = useAction();
  const [form, setForm] = useState({
    apartmentNumber: apartment?.apartment_number ?? "",
    residentSurname: apartment?.resident_surname ?? "",
    isActive: apartment?.is_active ?? true,
    initialReading: apartment?.initial_reading != null ? String(apartment.initial_reading) : "",
    initialReadingDate: apartment?.initial_reading_date ?? "",
    reason: "",
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {apartment ? (
          <Button variant="ghost" size="sm" aria-label={`Редагувати квартиру ${apartment.apartment_number}`}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden />
            Додати квартиру
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={apartment ? `Квартира №${apartment.apartment_number}` : "Нова квартира"}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() =>
              saveApartmentAction({
                id: apartment?.id,
                apartmentNumber: form.apartmentNumber,
                residentSurname: form.residentSurname,
                isActive: form.isActive,
                initialReading: form.initialReading || undefined,
                initialReadingDate: form.initialReadingDate || undefined,
                reason: form.reason || undefined,
              }),
            );
            if (ok) setOpen(false);
          }}
        >
          {error && !Object.keys(fieldErrors).length && <Notice tone="danger">{error}</Notice>}
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="Номер" htmlFor="apt-num" error={fieldErrors.apartmentNumber}>
              <Input id="apt-num" value={form.apartmentNumber} onChange={(e) => set("apartmentNumber", e.target.value)} />
            </Field>
            <Field label="Прізвище мешканця" htmlFor="apt-surname" error={fieldErrors.residentSurname}>
              <Input id="apt-surname" value={form.residentSurname} onChange={(e) => set("residentSurname", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Початковий показник" htmlFor="apt-initial" hint="Для першого розрахунку" error={fieldErrors.initialReading}>
              <Input id="apt-initial" inputMode="decimal" value={form.initialReading} onChange={(e) => set("initialReading", e.target.value)} />
            </Field>
            <Field label="Дата показника" htmlFor="apt-initial-date">
              <Input id="apt-initial-date" type="date" value={form.initialReadingDate} onChange={(e) => set("initialReadingDate", e.target.value)} />
            </Field>
          </div>
          <Checkbox label="Квартира активна" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
          {apartment && (
            <Field label="Причина зміни" htmlFor="apt-reason">
              <Input id="apt-reason" value={form.reason} onChange={(e) => set("reason", e.target.value)} />
            </Field>
          )}
          <Button type="submit" disabled={pending}>{pending ? "Зберігаємо…" : "Зберегти"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CodeReveal({ code, number }: { code: string; number: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="signal" title="Запишіть або скопіюйте код зараз">
        Код показується лише один раз. Передайте його мешканцю квартири №{number} особисто. Код діє постійно, поки ви не зміните
        його.
      </Notice>
      <dl className="rounded-[var(--radius-control)] bg-face px-4 py-3 text-white">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-white/70">Номер квартири</dt>
          <dd className="font-display text-xl">{number}</dd>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <dt className="text-sm text-white/70">Код доступу</dt>
          <dd className="font-display tabular text-2xl tracking-wider">{code}</dd>
        </div>
      </dl>
      <Button
        variant="signal"
        className="self-start"
        onClick={() =>
          navigator.clipboard
            .writeText(`Квартира: ${number}\nКод доступу: ${code}`)
            .then(() => toast.success("Скопійовано"))
        }
      >
        <Copy aria-hidden />
        Копіювати
      </Button>
    </div>
  );
}

export function CodeButton({
  apartmentId,
  number,
  hasAccess,
  codeSetAt,
}: {
  apartmentId: string;
  number: string;
  hasAccess: boolean;
  codeSetAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setCode(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={hasAccess ? "outline" : "primary"} size="sm">
          <KeyRound aria-hidden />
          {hasAccess ? "Змінити код" : "Видати код"}
        </Button>
      </DialogTrigger>
      <DialogContent title={`Код доступу, кв. №${number}`}>
        {code ? (
          <CodeReveal code={code} number={number} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[15px]">
              Мешканець входить за номером квартири <b>{number}</b> і кодом доступу.
            </p>
            {hasAccess ? (
              <Notice tone="warn">
                Квартира вже має код{codeSetAt ? ` (виданий ${new Date(codeSetAt).toLocaleDateString("uk-UA")})` : ""}. Новий код
                замінить його — старий одразу перестане діяти. Робіть це, якщо код загубили або ним міг скористатися хтось інший.
              </Notice>
            ) : (
              <p className="text-[15px] text-ink-soft">Код видається один раз і діє постійно. Змінити його можете лише ви.</p>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            <Button
              className="self-start"
              disabled={pending}
              onClick={() => run(() => generateCodeAction(apartmentId), { onSuccess: (r) => setCode(r.data!.code) })}
            >
              {pending ? "Зачекайте…" : hasAccess ? "Згенерувати новий код" : "Згенерувати код"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function downloadCsv(name: string, rows: string[][]) {
  const csv = "﻿" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkCodes() {
  const [result, setResult] = useState<{ codes: { apartment_number: string; resident_surname: string; code: string }[]; failed: string[] } | null>(null);
  const { run, pending } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <ConfirmDialog
        trigger={<Button variant="outline">Видати коди всім квартирам без доступу</Button>}
        title="Видати коди всім квартирам без доступу?"
        description="Коди отримають лише активні квартири, які ще не мають коду. Наявні коди не зміняться. Нові коди буде показано один раз."
        confirmLabel="Видати коди"
        onConfirm={() => run(() => generateCodesBulkAction(), { onSuccess: (r) => setResult(r.data!) })}
      />
      {pending && <p className="text-ink-soft">Видаємо коди…</p>}
      {result && result.codes.length > 0 && (
        <Notice tone="signal" title={`Видано кодів: ${result.codes.length}`}>
          <p>Завантажте файл зараз — повторно переглянути коди неможливо.</p>
          <Button
            className="mt-2"
            variant="primary"
            size="sm"
            onClick={() =>
              downloadCsv("kody-dostupu.csv", [
                ["Квартира", "Прізвище", "Код доступу"],
                ...result.codes.map((c) => [c.apartment_number, c.resident_surname, c.code]),
              ])
            }
          >
            Завантажити CSV з кодами
          </Button>
        </Notice>
      )}
      {result && result.failed.length > 0 && (
        <Notice tone="danger" title="Не вдалося видати коди деяким квартирам">
          <ul className="list-disc pl-5">
            {result.failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

export function ImportApartments() {
  const [text, setText] = useState("");
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] text-ink-soft">
        CSV-файл або текст: номер квартири; прізвище; початковий показник (необов&apos;язково). Наявні квартири оновлюються.
      </p>
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 text-[15px] font-semibold hover:bg-face-soft">
        <Upload className="size-4" aria-hidden />
        Вибрати CSV-файл
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
      </label>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"1;Прізвище;12345\n2;Прізвище"} className="min-h-32 font-mono text-sm" aria-label="Дані для імпорту" />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button disabled={pending || !text.trim()} onClick={() => run(() => importApartmentsAction(text), { onSuccess: () => setText("") })}>
        {pending ? "Імпортуємо…" : "Імпортувати"}
      </Button>
    </div>
  );
}

export function UserActions({
  profileId,
  isActive,
  role,
  isSelf,
}: {
  profileId: string;
  isActive: boolean;
  role: "resident" | "admin";
  isSelf: boolean;
}) {
  const { run } = useAction();
  const [reason, setReason] = useState("");
  if (isSelf) return <span className="text-sm text-ink-soft">Це ви</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <ConfirmDialog
        trigger={<Button size="sm" variant={isActive ? "outline" : "ok"}>{isActive ? "Деактивувати" : "Активувати"}</Button>}
        title={isActive ? "Деактивувати користувача?" : "Активувати користувача?"}
        description={isActive ? "Користувач не зможе вносити показники та подавати платежі. Квартира стане доступною для нової реєстрації." : undefined}
        confirmLabel={isActive ? "Деактивувати" : "Активувати"}
        tone={isActive ? "danger" : "ok"}
        onConfirm={() => run(() => setUserActiveAction({ profileId, active: !isActive, reason }))}
      >
        <Field label="Причина" htmlFor={`r-${profileId}`}>
          <Input id={`r-${profileId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        trigger={<Button size="sm" variant="ghost">{role === "admin" ? "Зняти роль адміністратора" : "Зробити адміністратором"}</Button>}
        title={role === "admin" ? "Зняти роль адміністратора?" : "Надати права адміністратора?"}
        description="Адміністратор має доступ до всіх фінансових даних і квитанцій."
        confirmLabel="Змінити роль"
        onConfirm={() => {
          if (reason.trim().length < 3) {
            toast.error("Вкажіть причину зміни ролі");
            return false;
          }
          return run(() => setUserRoleAction({ profileId, role: role === "admin" ? "resident" : "admin", reason }));
        }}
      >
        <Field label="Причина (обов'язково)" htmlFor={`rr-${profileId}`}>
          <Input id={`rr-${profileId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

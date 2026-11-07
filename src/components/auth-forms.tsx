"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, Checkbox, Field, Input, Notice } from "@/components/ui/controls";
import { changePasswordAction, eraseMyPersonalDataAction, signInAction } from "@/app/actions/auth";
import { setMyNameAction } from "@/app/actions/resident";
import type { ActionResult } from "@/lib/types";

function fieldError(state: ActionResult | null, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

function FormError({ state }: { state: ActionResult | null }) {
  if (!state || state.ok || state.fieldErrors) return null;
  return <Notice tone="danger">{state.error}</Notice>;
}

/**
 * Згода на обробку персональних даних: лише позначка з посиланням на повний текст (/privacy).
 * Позначка не стоїть заздалегідь — її ставить сам користувач під час кожного входу.
 */
function ConsentBlock({ error }: { error?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-start gap-3 text-[15px]">
        <input
          type="checkbox"
          name="consent"
          value="yes"
          required
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-5 shrink-0 accent-[var(--face)]"
        />
        <span>
          Я погоджуюся з{" "}
          <Link href="/privacy" target="_blank" rel="noopener" className="font-medium text-face underline underline-offset-4">
            умовами користування та обробки персональних даних
          </Link>{" "}
          і даю згоду на обробку моїх персональних даних
        </span>
      </label>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Вхід мешканця (номер квартири + код) або адміністратора (пошта + пароль). */
export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next ?? "/"} />
      <FormError state={state} />
      <Field
        label="Номер квартири"
        htmlFor="login"
        hint="Адміністратор вводить тут свою електронну пошту"
        error={fieldError(state, "login")}
      >
        <Input id="login" name="login" autoComplete="username" autoCapitalize="none" required />
      </Field>
      <Field
        label="Код доступу"
        htmlFor="secret"
        hint="Код видає адміністратор будинку. Регістр і дефіс не важливі"
        error={fieldError(state, "secret")}
      >
        <Input id="secret" name="secret" type="password" autoComplete="current-password" placeholder="ABCDE-12345" required />
      </Field>
      <ConsentBlock error={fieldError(state, "consent")} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Вхід…" : "Увійти"}
      </Button>
      <p className="text-[15px] text-ink-soft">
        Немає коду або загубили його? Зверніться до адміністратора будинку — він видасть код для вашої квартири.
      </p>
    </form>
  );
}

/** Мешканець вказує, змінює або видаляє прізвище та ім'я своєї квартири. */
export function MyNameForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(setMyNameAction, null);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {state?.ok && <Notice tone="ok">{state.message}</Notice>}
      <FormError state={state} />
      <Field
        label="Прізвище та ім'я (необов'язково)"
        htmlFor="my-name"
        hint="Можна залишити порожнім — квартира визначається номером. Інші мешканці бачать це ім'я в загальній таблиці."
        error={fieldError(state, "name")}
      >
        <Input id="my-name" name="name" defaultValue={current ?? ""} maxLength={100} autoComplete="name" />
      </Field>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Зберігаємо…" : "Зберегти"}
      </Button>
    </form>
  );
}

/** Відкликання згоди та видалення персональних даних мешканцем. */
export function EraseMyDataForm() {
  const [state, action, pending] = useActionState(eraseMyPersonalDataAction, null);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormError state={state} />
      <Notice tone="warn" title="Що станеться">
        <ul className="list-disc pl-5">
          <li>прізвище та ім&apos;я вашої квартири буде видалено, зокрема з журналу змін;</li>
          <li>згоду буде відкликано, а обліковий запис квартири — деактивовано (ви вийдете з застосунку);</li>
          <li>
            облікові дані квартири (показники, суми, платежі, квитанції) лишаться за номером квартири — вони потрібні для
            спільних розрахунків будинку;
          </li>
          <li>щоб повернутися, попросіть адміністратора видати новий код доступу.</li>
        </ul>
      </Notice>
      <Checkbox
        name="confirm"
        value="yes"
        label="Я розумію наслідки і хочу відкликати згоду та видалити мої персональні дані"
      />
      {fieldError(state, "confirm") && (
        <p className="text-sm text-danger" role="alert">
          {fieldError(state, "confirm")}
        </p>
      )}
      <Button type="submit" variant="danger" className="self-start" disabled={pending}>
        {pending ? "Видаляємо…" : "Відкликати згоду та видалити мої дані"}
      </Button>
    </form>
  );
}

/** Зміна пароля адміністратора (мешканцям код змінює адміністратор). */
export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError state={state} />
      <Field label="Новий пароль" htmlFor="password" hint="Щонайменше 8 символів, літери та цифри" error={fieldError(state, "password")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Підтвердження пароля" htmlFor="passwordConfirm" error={fieldError(state, "passwordConfirm")}>
        <Input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Зберігаємо…" : "Змінити пароль"}
      </Button>
    </form>
  );
}

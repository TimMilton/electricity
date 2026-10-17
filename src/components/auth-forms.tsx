"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui/controls";
import { forgotPasswordAction, registerAction, resetPasswordAction, signInAction } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/types";

function fieldError(state: ActionResult | null, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

function FormError({ state }: { state: ActionResult | null }) {
  if (!state || state.ok || state.fieldErrors) return null;
  return <Notice tone="danger">{state.error}</Notice>;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next ?? "/"} />
      <FormError state={state} />
      <Field label="Електронна пошта" htmlFor="email" error={fieldError(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field label="Пароль" htmlFor="password" error={fieldError(state, "password")}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Вхід…" : "Увійти"}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-[15px]">
        <Link href="/forgot-password" className="text-face underline underline-offset-4">
          Забули пароль?
        </Link>
        <Link href="/register" className="text-face underline underline-offset-4">
          Зареєструватися
        </Link>
      </div>
    </form>
  );
}

export function RegisterForm({ codeRequired }: { codeRequired: boolean }) {
  const [state, action, pending] = useActionState(registerAction, null);
  if (state?.ok) {
    return (
      <Notice tone="ok" title="Майже готово">
        {state.message}
        <p className="mt-2">
          <Link href="/login" className="underline underline-offset-4">
            Перейти до входу
          </Link>
        </p>
      </Notice>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError state={state} />
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <Field label="Квартира №" htmlFor="apartmentNumber" error={fieldError(state, "apartmentNumber")}>
          <Input id="apartmentNumber" name="apartmentNumber" inputMode="text" autoComplete="off" required />
        </Field>
        <Field label="Прізвище" htmlFor="surname" error={fieldError(state, "surname")}>
          <Input id="surname" name="surname" autoComplete="family-name" required />
        </Field>
      </div>
      <Field
        label={codeRequired ? "Код підтвердження квартири" : "Код підтвердження (якщо отримали)"}
        htmlFor="code"
        hint="Код видає адміністратор будинку. Він одноразовий."
        error={fieldError(state, "code")}
      >
        <Input id="code" name="code" autoComplete="one-time-code" autoCapitalize="characters" placeholder="ABCDE-12345" required={codeRequired} />
      </Field>
      <Field label="Електронна пошта" htmlFor="email" error={fieldError(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field label="Пароль" htmlFor="password" hint="Щонайменше 8 символів, літери та цифри" error={fieldError(state, "password")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Підтвердження пароля" htmlFor="passwordConfirm" error={fieldError(state, "passwordConfirm")}>
        <Input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Перевіряємо дані…" : "Зареєструватися"}
      </Button>
      <p className="text-[15px] text-ink-soft">
        Не вдається підтвердити квартиру? Зверніться до адміністратора будинку — він перевірить дані та видасть новий код.
      </p>
      <p className="text-[15px]">
        Уже маєте обліковий запис?{" "}
        <Link href="/login" className="text-face underline underline-offset-4">
          Увійти
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError state={state} />
      <Field label="Електронна пошта" htmlFor="email" error={fieldError(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Надсилаємо…" : "Надіслати посилання"}
      </Button>
      <Link href="/login" className="text-[15px] text-face underline underline-offset-4">
        Повернутися до входу
      </Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  if (state?.ok) {
    return (
      <Notice tone="ok" title={state.message}>
        <Link href="/" className="underline underline-offset-4">
          Перейти до застосунку
        </Link>
      </Notice>
    );
  }
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

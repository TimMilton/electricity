"use client";

import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui/controls";
import { changePasswordAction, signInAction } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/types";

function fieldError(state: ActionResult | null, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

function FormError({ state }: { state: ActionResult | null }) {
  if (!state || state.ok || state.fieldErrors) return null;
  return <Notice tone="danger">{state.error}</Notice>;
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
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Вхід…" : "Увійти"}
      </Button>
      <p className="text-[15px] text-ink-soft">
        Немає коду або загубили його? Зверніться до адміністратора будинку — він видасть код для вашої квартири.
      </p>
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

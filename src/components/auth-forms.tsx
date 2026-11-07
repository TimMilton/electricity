"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, Checkbox, Field, Input, Notice } from "@/components/ui/controls";
import { changePasswordAction, eraseMyPersonalDataAction, signInAction } from "@/app/actions/auth";
import { CONSENT_POINTS } from "@/lib/legal";
import type { ActionResult } from "@/lib/types";

function fieldError(state: ActionResult | null, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

function FormError({ state }: { state: ActionResult | null }) {
  if (!state || state.ok || state.fieldErrors) return null;
  return <Notice tone="danger">{state.error}</Notice>;
}

/**
 * Згода на обробку персональних даних. Позначка не стоїть заздалегідь:
 * її ставить сам користувач під час кожного входу (ст. 2, 11 Закону № 2297-VI).
 */
function ConsentBlock({ error }: { error?: string }) {
  return (
    <fieldset className="rounded-[var(--radius-control)] border border-line bg-casing/40 p-4" aria-describedby="consent-points">
      <legend className="px-1 text-sm font-semibold">Згода на обробку персональних даних</legend>
      <ol id="consent-points" className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink-soft">
        {CONSENT_POINTS.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
      <p className="mt-2 text-sm">
        <Link href="/privacy" target="_blank" rel="noopener" className="font-medium text-face underline underline-offset-4">
          Повідомлення про обробку персональних даних та Умови користування
        </Link>
      </p>
      <Checkbox
        className="mt-3 font-medium"
        name="consent"
        value="yes"
        required
        aria-invalid={error ? true : undefined}
        label="Я ознайомився(-лася), погоджуюся з наведеним і даю згоду на обробку моїх персональних даних"
      />
      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
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

/** Відкликання згоди та видалення персональних даних мешканцем. */
export function EraseMyDataForm() {
  const [state, action, pending] = useActionState(eraseMyPersonalDataAction, null);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormError state={state} />
      <Notice tone="warn" title="Що станеться">
        <ul className="list-disc pl-5">
          <li>прізвище та під&apos;їзд вашої квартири буде видалено, зокрема з журналу змін;</li>
          <li>згоду буде відкликано, а обліковий запис квартири — деактивовано (ви вийдете з застосунку);</li>
          <li>
            записи розрахунків (показники, суми, платежі, квитанції) лишаться за номером квартири без прізвища — вони потрібні для
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

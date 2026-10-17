"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";
import { zodToResult } from "@/lib/errors";
import { forgotPasswordSchema, loginSchema, registrationSchema, resetPasswordSchema } from "@/lib/validation";
import { VIEW_AS_COOKIE } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";

const VERIFY_FAILED =
  "Не вдалося підтвердити квартиру. Перевірте номер квартири, прізвище та код підтвердження або зверніться до адміністратора";

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const admin = createServiceClient();
  const { data, error } = await admin.rpc("check_rate_limit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) return false; // у разі збою — безпечна відмова
  return data === true;
}

function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

export async function signInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return zodToResult(parsed.error.issues);

  const ip = await clientIp();
  if (!(await rateLimit(`login:${ip}`, 20, 15 * 60))) {
    return { ok: false, error: "Забагато спроб входу. Спробуйте через 15 хвилин" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { ok: false, error: "Електронну пошту ще не підтверджено. Перейдіть за посиланням у листі" };
    }
    return { ok: false, error: "Невірна електронна пошта або пароль" };
  }
  redirect(safeNext(formData.get("next")));
}

export async function registerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = registrationSchema.safeParse({
    apartmentNumber: formData.get("apartmentNumber"),
    surname: formData.get("surname"),
    email: formData.get("email"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
    code: formData.get("code") ?? "",
  });
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const d = parsed.data;

  const ip = await clientIp();
  const okIp = await rateLimit(`register:ip:${ip}`, 10, 60 * 60);
  const okApt = await rateLimit(`register:apt:${d.apartmentNumber.toLowerCase()}`, 10, 60 * 60);
  if (!okIp || !okApt) {
    return { ok: false, error: "Забагато спроб реєстрації. Спробуйте пізніше або зверніться до адміністратора" };
  }

  const admin = createServiceClient();
  const { data: verify, error: verifyError } = await admin.rpc("registration_verify", {
    p_apartment_number: d.apartmentNumber,
    p_surname: d.surname,
    p_code: d.code,
  });
  if (verifyError) return { ok: false, error: VERIFY_FAILED };
  const v = verify as { ok: boolean; reason?: string; apartment_id?: string };
  if (!v.ok || !v.apartment_id) {
    if (v.reason === "registration_closed") {
      return { ok: false, error: "Самостійна реєстрація зараз закрита. Зверніться до адміністратора" };
    }
    if (v.reason === "locked") {
      return { ok: false, error: "Перевірку тимчасово заблоковано через забагато невдалих спроб. Спробуйте пізніше або зверніться до адміністратора" };
    }
    return { ok: false, error: VERIFY_FAILED };
  }

  const supabase = await createClient();
  const { data: signUp, error: signUpError } = await supabase.auth.signUp({
    email: d.email,
    password: d.password,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=/home`, data: { surname: d.surname } },
  });
  const userId = signUp.user?.id;
  // Supabase повертає користувача без identities, якщо пошта вже зареєстрована
  if (signUpError || !userId || (signUp.user?.identities && signUp.user.identities.length === 0)) {
    if (signUpError?.code === "weak_password") return { ok: false, error: "Пароль надто простий. Оберіть складніший" };
    return { ok: false, error: "Не вдалося створити обліковий запис. Можливо, ця пошта вже використовується — спробуйте увійти або відновити пароль" };
  }

  const { error: completeError } = await admin.rpc("registration_complete", {
    p_auth_user_id: userId,
    p_apartment_id: v.apartment_id,
    p_surname: d.surname,
    p_code: d.code,
  });
  if (completeError) {
    // Відкат: обліковий запис без підтвердженої квартири не залишається
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    await supabase.auth.signOut().catch(() => undefined);
    return { ok: false, error: completeError.code === "P0001" ? completeError.message : VERIFY_FAILED };
  }

  if (signUp.session) redirect("/home");
  return {
    ok: true,
    message: "Обліковий запис створено. Ми надіслали лист для підтвердження електронної пошти — перейдіть за посиланням у ньому, щоб увійти.",
  };
}

export async function forgotPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const ip = await clientIp();
  if (await rateLimit(`reset:${ip}`, 5, 60 * 60)) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${siteUrl()}/auth/callback?next=/auth/reset-password`,
    });
  }
  // Однакова відповідь незалежно від існування пошти
  return { ok: true, message: "Якщо обліковий запис із цією поштою існує, ми надіслали лист із посиланням для зміни пароля." };
}

export async function resetPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "Посилання недійсне або застаріло. Запросіть новий лист" };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: "Не вдалося змінити пароль. Спробуйте інший пароль" };
  return { ok: true, message: "Пароль змінено" };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/login");
}

"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSession, VIEW_AS_COOKIE } from "@/lib/auth";
import { zodToResult } from "@/lib/errors";
import { loginSchema, resetPasswordSchema } from "@/lib/validation";
import { normalizeAccessCode } from "@/lib/access-code";
import type { ActionResult } from "@/lib/types";

const RESIDENT_LOGIN_FAILED = "Невірний номер квартири або код доступу. Якщо код загубився, зверніться до адміністратора";
const ADMIN_LOGIN_FAILED = "Невірна електронна пошта або пароль";

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service.rpc("check_rate_limit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) return false; // у разі збою — безпечна відмова
  return data === true;
}

function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

/**
 * Вхід:
 *   мешканець — номер квартири + код доступу від адміністратора;
 *   адміністратор — електронна пошта + пароль (у тому самому полі).
 */
export async function signInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ login: formData.get("login"), secret: formData.get("secret") });
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const { login, secret } = parsed.data;
  const isAdminLogin = login.includes("@");

  const ip = await clientIp();
  if (!(await rateLimit(`login:${ip}`, 30, 15 * 60))) {
    return { ok: false, error: "Забагато спроб входу. Спробуйте через 15 хвилин" };
  }

  let email: string;
  let password: string;
  if (isAdminLogin) {
    email = login.toLowerCase();
    password = secret;
  } else {
    if (!(await rateLimit(`login:apt:${login.toLowerCase()}`, 10, 15 * 60))) {
      return { ok: false, error: "Забагато невдалих спроб для цієї квартири. Спробуйте через 15 хвилин" };
    }
    const service = createServiceClient();
    const { data, error } = await service.rpc("system_login_email_for_apartment", { p_apartment_number: login });
    if (error || !data) return { ok: false, error: RESIDENT_LOGIN_FAILED };
    email = String(data);
    password = normalizeAccessCode(secret);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: isAdminLogin ? ADMIN_LOGIN_FAILED : RESIDENT_LOGIN_FAILED };
  redirect(safeNext(formData.get("next")));
}

/** Зміна власного пароля — лише для адміністратора. Код мешканця змінює адміністратор. */
export async function changePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const session = await getSession();
  if (!session) return { ok: false, error: "Потрібно увійти в систему" };
  if (!session.isAdmin) return { ok: false, error: "Код доступу змінює адміністратор будинку" };
  const supabase = await createClient();
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

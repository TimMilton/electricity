"use server";

import { createHash } from "node:crypto";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSession, VIEW_AS_COOKIE } from "@/lib/auth";
import { zodToResult } from "@/lib/errors";
import { CONSENT_REQUIRED_MESSAGE, loginConsentSchema, loginSchema, resetPasswordSchema } from "@/lib/validation";
import { normalizeAccessCode } from "@/lib/access-code";
import { CONSENT_VERSION, consentCanonicalText } from "@/lib/legal";
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
 * Обидва — лише з позначкою згоди на обробку персональних даних; факт згоди
 * (версія й хеш тексту, час, IP, браузер) записується в personal_data_consents.
 */
export async function signInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ login: formData.get("login"), secret: formData.get("secret") });
  const consent = loginConsentSchema.safeParse(formData.get("consent"));
  if (!parsed.success || !consent.success) {
    const issues = [
      ...(parsed.success ? [] : parsed.error.issues),
      ...(consent.success ? [] : [{ path: ["consent"], message: CONSENT_REQUIRED_MESSAGE }]),
    ];
    return zodToResult(issues);
  }
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
  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !signedIn.user) return { ok: false, error: isAdminLogin ? ADMIN_LOGIN_FAILED : RESIDENT_LOGIN_FAILED };

  // Без збереженого доказу згоди вхід не завершується
  const h = await headers();
  const { error: consentError } = await createServiceClient().rpc("system_record_consent", {
    p_auth_user_id: signedIn.user.id,
    p_version: CONSENT_VERSION,
    p_text_sha256: createHash("sha256").update(consentCanonicalText(), "utf8").digest("hex"),
    p_ip: ip,
    p_user_agent: h.get("user-agent") ?? "",
  });
  if (consentError) {
    console.error("system_record_consent:", consentError.code, consentError.message);
    await supabase.auth.signOut({ scope: "local" });
    return {
      ok: false,
      error:
        consentError.code === "P0001"
          ? consentError.message
          : "Не вдалося зберегти згоду на обробку персональних даних. Спробуйте ще раз або зверніться до адміністратора",
    };
  }
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

/**
 * Мешканець відкликає згоду і видаляє свої персональні дані:
 * прізвище й під'їзд квартири, прізвище в обліковому записі та в журналі змін.
 * Обліковий запис деактивується; облікові записи розрахунків лишаються за номером квартири.
 */
export async function eraseMyPersonalDataAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (formData.get("confirm") !== "yes") {
    return { ok: false, error: "Підтвердіть, що розумієте наслідки видалення", fieldErrors: { confirm: "Поставте позначку" } };
  }
  const session = await getSession();
  if (!session) return { ok: false, error: "Потрібно увійти в систему" };
  if (session.isAdmin) return { ok: false, error: "Адміністратор не може видалити власні дані цим способом" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resident_erase_my_personal_data");
  if (error) {
    console.error("resident_erase_my_personal_data:", error.code, error.message);
    return { ok: false, error: error.code === "P0001" ? error.message : "Не вдалося видалити дані. Спробуйте пізніше або зверніться до адміністратора" };
  }
  await supabase.auth.signOut();
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/login?notice=erased");
}

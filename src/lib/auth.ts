import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Apartment, Profile } from "@/lib/types";

export const VIEW_AS_COOKIE = "eo_view_as";

export type Session = {
  userId: string;
  email: string | null;
  profile: Profile;
  isAdmin: boolean;
};

/** Ідентифікатор користувача Supabase Auth (без перевірки профілю). */
const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/** Профіль користувача Auth (без перевірки згоди). */
const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, auth_user_id, apartment_id, surname, role, is_primary, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle<Profile>();
  return profile ?? null;
});

/**
 * Чи має користувач чинну згоду на обробку персональних даних (поточної
 * редакції). У разі будь-якої помилки — «ні»: без підтвердженої згоди
 * обліковий запис не відкривається.
 */
const hasValidConsent = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_consent_status");
  if (error) {
    console.error("my_consent_status:", error.code, error.message);
    return false;
  }
  return (data as { ok?: boolean } | null)?.ok === true;
});

/**
 * Поточний користувач і профіль (кешується в межах запиту).
 * Без чинної згоди на обробку персональних даних сесії застосунку немає.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const profile = await getProfile();
  if (!profile) return null;
  if (!(await hasValidConsent())) return null;
  return { userId: user.id, email: user.email ?? null, profile, isAdmin: profile.role === "admin" && profile.is_active };
});

/** Куди спрямувати користувача без сесії застосунку:
 *  немає входу → сторінка входу;
 *  є вхід і профіль, але немає згоди → примусовий вихід і повторний вхід зі згодою;
 *  є вхід, але немає профілю → «Доступ обмежено» (інакше виникла б петля перенаправлень). */
export async function unauthenticatedRedirect(): Promise<never> {
  if (!(await getAuthUser())) redirect("/login");
  if ((await getProfile()) && !(await hasValidConsent())) redirect("/auth/signout?notice=consent");
  redirect("/auth/inactive");
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) return unauthenticatedRedirect();
  if (!s.profile.is_active) redirect("/auth/inactive");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.isAdmin) redirect("/home");
  return s;
}

export type ActingContext = {
  session: Session;
  apartment: Apartment;
  /** Адміністратор переглядає інтерфейс квартири */
  viewAs: boolean;
};

/**
 * Квартира, з якою працює інтерфейс мешканця.
 * Для адміністратора в режимі «Переглянути як мешканець» — обрана квартира
 * (cookie враховується лише якщо користувач справді адміністратор).
 * Автором усіх дій залишається реальний користувач сесії.
 */
export const getActingContext = cache(async (): Promise<ActingContext | null> => {
  const session = await requireSession();
  const supabase = await createClient();
  let apartmentId = session.profile.apartment_id;
  let viewAs = false;
  if (session.isAdmin) {
    const store = await cookies();
    const v = store.get(VIEW_AS_COOKIE)?.value;
    if (v && /^[0-9a-f-]{36}$/i.test(v)) {
      apartmentId = v;
      viewAs = true;
    } else {
      return null;
    }
  }
  if (!apartmentId) return null;
  const base = "id, apartment_number, resident_surname, is_active, registration_status";
  const res = await supabase
    .from("apartments")
    .select(`${base}, entrance`)
    .eq("id", apartmentId)
    .maybeSingle<Apartment>();
  let apartment = res.data;
  const error = res.error;
  if (error) {
    // Міграцію з під'їздом ще не застосовано (немає стовпчика) — працюємо без нього,
    // щоб вхід і перегляд не ламалися через порядок оновлення бази та коду.
    console.error("getActingContext apartments:", error.code, error.message);
    const fallback = await supabase.from("apartments").select(base).eq("id", apartmentId).maybeSingle<Omit<Apartment, "entrance">>();
    apartment = fallback.data ? { ...fallback.data, entrance: null } : null;
  }
  if (!apartment) return null;
  return { session, apartment, viewAs };
});

/** Для сторінок мешканця: адміністратор без обраної квартири → у панель. */
export async function requireActingContext(): Promise<ActingContext> {
  const ctx = await getActingContext();
  if (!ctx) {
    const s = await requireSession();
    if (s.isAdmin) redirect("/admin/view-as");
    redirect("/auth/inactive");
  }
  return ctx;
}

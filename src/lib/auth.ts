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

/** Поточний користувач і профіль (кешується в межах запиту). */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, auth_user_id, apartment_id, surname, role, is_primary, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle<Profile>();
  if (!profile) return null;
  return { userId: user.id, email: user.email ?? null, profile, isAdmin: profile.role === "admin" && profile.is_active };
});

/** Куди спрямувати користувача без сесії застосунку: вхід або «Доступ обмежено»
 *  (обліковий запис Auth є, але профілю немає — інакше виникла б петля перенаправлень). */
export async function unauthenticatedRedirect(): Promise<never> {
  redirect((await getAuthUser()) ? "/auth/inactive" : "/login");
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
  const { data: apartment } = await supabase
    .from("apartments")
    .select("id, apartment_number, resident_surname, is_active, registration_status")
    .eq("id", apartmentId)
    .maybeSingle<Apartment>();
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

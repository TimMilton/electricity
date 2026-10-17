import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { AUTH_COOKIE_NAME, supabasePublicKey, supabaseUrl } from "@/lib/env";

/** Клієнт від імені поточного користувача (RLS застосовується). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabasePublicKey(), {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // виклик із Server Component — оновлення сесії виконує proxy
        }
      },
    },
  });
}

/**
 * Клієнт із сервісним ключем. ЛИШЕ на сервері, лише для:
 *  - реєстрації (перевірка коду квартири, створення профілю);
 *  - обмеження частоти запитів;
 *  - прибирання файлів, що не пройшли перевірку;
 *  - синхронізації налаштувань бакета.
 * Ніколи не використовується для звичайних запитів користувача.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY не налаштовано");
  return createSupabaseClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

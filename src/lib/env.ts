/**
 * Конфігурація читається під час виконання (а не вшивається під час збірки),
 * тож один Docker-образ працює з будь-яким Supabase.
 *
 *   SUPABASE_URL          — адреса Supabase для сервера застосунку
 *                           (у Docker — внутрішня, напр. http://gateway:8000)
 *   SUPABASE_PUBLIC_URL   — адреса Supabase для браузера (підписані посилання
 *                           на квитанції); за замовчуванням = SUPABASE_URL
 *   SUPABASE_ANON_KEY     — публічний (anon / publishable) ключ
 *   SUPABASE_SERVICE_ROLE_KEY — сервісний ключ, лише сервер
 *   SITE_URL              — публічна адреса застосунку
 *
 * Старі назви NEXT_PUBLIC_* підтримуються як запасний варіант.
 */

function first(...values: (string | undefined)[]): string | undefined {
  for (const v of values) if (v && v.trim()) return v.trim();
  return undefined;
}

function trimSlash(v: string): string {
  return v.replace(/\/+$/, "");
}

export function supabaseUrlOrNull(): string | null {
  const v = first(process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL);
  return v ? trimSlash(v) : null;
}

export function supabaseAnonKeyOrNull(): string | null {
  return (
    first(
      process.env.SUPABASE_ANON_KEY,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ) ?? null
  );
}

export function supabaseUrl(): string {
  const v = supabaseUrlOrNull();
  if (!v) throw new Error("SUPABASE_URL не налаштовано (див. .env.example)");
  return v;
}

export function supabasePublicKey(): string {
  const v = supabaseAnonKeyOrNull();
  if (!v) throw new Error("SUPABASE_ANON_KEY не налаштовано (див. .env.example)");
  return v;
}

/** Адреса Supabase, доступна з браузера. */
export function supabasePublicUrl(): string {
  const v = first(process.env.SUPABASE_PUBLIC_URL);
  return v ? trimSlash(v) : supabaseUrl();
}

/** Замінити внутрішню адресу Supabase на публічну (для посилань, які відкриває браузер). */
export function toPublicSupabaseUrl(url: string): string {
  const internal = supabaseUrl();
  const pub = supabasePublicUrl();
  return url.startsWith(internal) ? pub + url.slice(internal.length) : url;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrlOrNull() && supabaseAnonKeyOrNull());
}

export function siteUrl(): string {
  return trimSlash(first(process.env.SITE_URL, process.env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000");
}

/**
 * Стала назва cookie сесії: не залежить від адреси Supabase, тож зміна
 * SUPABASE_URL (напр. внутрішня адреса в Docker) не розлогінює користувачів.
 */
export const AUTH_COOKIE_NAME = "sb-elektrooblik-auth-token";

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_NAME, supabaseAnonKeyOrNull, supabasePublicUrl, supabaseUrlOrNull } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/auth", "/setup-required", "/preview"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Content-Security-Policy формується під час запиту: адреса Supabase для
 * браузера (підписані посилання на квитанції) береться зі змінних середовища.
 */
function contentSecurityPolicy(): string {
  let supabaseOrigin = "";
  try {
    if (supabaseUrlOrNull()) supabaseOrigin = new URL(supabasePublicUrl()).origin;
  } catch {
    supabaseOrigin = "";
  }
  const extra = supabaseOrigin ? ` ${supabaseOrigin}` : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    // Next.js інлайнить скрипти гідратації
    "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${extra}`,
    `frame-src 'self' blob:${extra}`,
    `connect-src 'self'${extra}`,
    "font-src 'self' data:",
  ].join("; ");
}

function secure<T extends NextResponse>(res: T): T {
  res.headers.set("Content-Security-Policy", contentSecurityPolicy());
  return res;
}

/**
 * Оновлює сесію Supabase у cookies і не пускає неавторизованих користувачів
 * на захищені сторінки. Перевірка ролі адміністратора — у layout /admin та
 * в кожній серверній дії/функції БД (proxy — не межа безпеки).
 */
export async function proxy(request: NextRequest) {
  const url = supabaseUrlOrNull();
  const key = supabaseAnonKeyOrNull();
  const { pathname } = request.nextUrl;

  // Попередній перегляд на вигаданих даних не потребує бази та сесії
  if (pathname === "/preview") return secure(NextResponse.next());

  if (!url || !key) {
    if (pathname === "/setup-required") return secure(NextResponse.next());
    return NextResponse.redirect(new URL("/setup-required", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    userId = (data?.claims?.sub as string | undefined) ?? null;
  } catch {
    userId = null;
  }

  if (!userId && !isPublic(pathname)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (userId && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return secure(response);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|icon.svg|robots.txt|email-templates|api/cron|api/health).*)"],
};

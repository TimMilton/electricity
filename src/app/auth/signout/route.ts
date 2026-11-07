import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AUTH_COOKIE_NAME } from "@/lib/env";
import { VIEW_AS_COOKIE } from "@/lib/auth";

const ALLOWED_NOTICES = new Set(["consent", "erased"]);

/**
 * Примусовий вихід (напр. немає чинної згоди на обробку персональних даних).
 * Server Component не може змінювати cookies, тому перенаправляє сюди.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.error("signout:", e);
  }
  const notice = request.nextUrl.searchParams.get("notice");
  const target = new URL("/login", request.nextUrl.origin);
  if (notice && ALLOWED_NOTICES.has(notice)) target.searchParams.set("notice", notice);

  const res = NextResponse.redirect(target);
  // Гарантовано прибрати cookie сесії (у т. ч. розбиті на частини: name.0, name.1, …)
  for (const c of (await cookies()).getAll()) {
    if (c.name === AUTH_COOKIE_NAME || c.name.startsWith(`${AUTH_COOKIE_NAME}.`) || c.name === VIEW_AS_COOKIE) {
      res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
    }
  }
  return res;
}

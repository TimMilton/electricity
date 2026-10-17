import { isSupabaseConfigured, supabaseUrl } from "@/lib/env";

/**
 * Перевірка стану для Docker HEALTHCHECK і моніторингу.
 *   /api/health        — застосунок працює
 *   /api/health?deep=1 — додатково перевіряє доступність Supabase Auth
 */
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  if (!deep) return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });

  if (!isSupabaseConfigured()) return Response.json({ ok: false, supabase: "not_configured" }, { status: 503 });
  try {
    const res = await fetch(`${supabaseUrl()}/auth/v1/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return Response.json({ ok: res.ok, supabase: res.ok ? "up" : `http_${res.status}` }, { status: res.ok ? 200 : 503 });
  } catch {
    return Response.json({ ok: false, supabase: "unreachable" }, { status: 503 });
  }
}

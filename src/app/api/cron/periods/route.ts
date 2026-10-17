import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Щоденна системна задача: створює період поточного місяця за типовими
 * налаштуваннями (якщо його ще немає) та оновлює статуси вікон приймання.
 * Захищено секретом CRON_SECRET (Vercel Cron передає його в Authorization).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET не налаштовано", { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { data, error } = await createServiceClient().rpc("system_ensure_current_period");
  if (error) return Response.json({ ok: false }, { status: 500 });
  const p = data as { year: number; month: number; status: string };
  return Response.json({ ok: true, period: `${p.year}-${p.month}`, status: p.status });
}

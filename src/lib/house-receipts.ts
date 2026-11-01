import "server-only";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { toPublicSupabaseUrl } from "@/lib/env";
import { planUploads, removeObjects, RECEIPTS_BUCKET, SIGNED_URL_TTL_SECONDS, type PlannedUpload, type ReceiptView, type SignedUpload, type VerifiedReceipt } from "@/lib/receipts";
import { sanitizeFilename, validateReceiptFile } from "@/lib/files";
import type { AppSettings } from "@/lib/types";

/*
  Квитанції про оплату за загальним лічильником. Файли лежать у приватному бакеті
  за шляхом house/<період>/<файл>. Усі операції зі сховищем виконує сервер сервісним
  ключем — лише після перевірки прав (адміністратор або доступ до запису через RLS).
*/

export type HouseReceiptView = ReceiptView & { note: string | null };

const HOUSE_PATH_RE = /^house\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/;

export function planHouseUploads(
  periodId: string,
  files: { name: string; type: string; size: number }[],
  settings: Pick<AppSettings, "allowed_receipt_mime_types" | "max_receipt_size_mb">,
) {
  // той самий план, що для квитанцій мешканців; префікс — house/<період>/
  return planUploads({ id: periodId, apartment_id: "house" }, files, settings);
}

/** Підписані посилання на завантаження (сервісним ключем, після перевірки прав). */
export async function signHouseUploads(
  uploads: (PlannedUpload & { contentType: string })[],
): Promise<{ ok: true; uploads: SignedUpload[] } | { ok: false; error: string }> {
  const storage = createServiceClient().storage.from(RECEIPTS_BUCKET);
  const signed: SignedUpload[] = [];
  for (const u of uploads) {
    const { data, error } = await storage.createSignedUploadUrl(u.path);
    if (error || !data?.token) return { ok: false, error: "Не вдалося підготувати завантаження файлу" };
    signed.push({ ...u, token: data.token });
  }
  return { ok: true, uploads: signed };
}

/** Перевірка завантажених файлів квитанції будинку за вмістом. */
export function verifyHouseUploads(
  periodId: string,
  uploads: PlannedUpload[],
  settings: Pick<AppSettings, "allowed_receipt_mime_types" | "max_receipt_size_mb">,
) {
  return verifyServiceUploads(`house/${periodId}/`, HOUSE_PATH_RE, uploads, settings);
}

/**
 * Перевірка файлів, завантажених за підписаними сервером посиланнями: шлях має
 * належати префіксу, тип визначається за вмістом. Файли, що не пройшли, видаляються.
 */
export async function verifyServiceUploads(
  prefix: string,
  pathRe: RegExp,
  uploads: PlannedUpload[],
  settings: Pick<AppSettings, "allowed_receipt_mime_types" | "max_receipt_size_mb">,
): Promise<{ ok: true; receipts: VerifiedReceipt[] } | { ok: false; error: string }> {
  const storage = createServiceClient().storage.from(RECEIPTS_BUCKET);
  const verified: VerifiedReceipt[] = [];
  for (const u of uploads) {
    if (!u.path.startsWith(prefix) || !pathRe.test(u.path)) return { ok: false, error: "Некоректний шлях до файлу квитанції" };
    const { data, error } = await storage.download(u.path);
    if (error || !data) return { ok: false, error: "Файл квитанції не знайдено. Завантажте його ще раз" };
    const bytes = new Uint8Array(await data.arrayBuffer());
    const check = validateReceiptFile(bytes, { size: bytes.byteLength, maxSizeMb: settings.max_receipt_size_mb, allowed: settings.allowed_receipt_mime_types });
    if (!check.ok) {
      await removeObjects([u.path]);
      return { ok: false, error: `«${sanitizeFilename(u.name)}»: ${check.error}` };
    }
    verified.push({ storage_path: u.path, original_filename: sanitizeFilename(u.name), mime_type: check.mime, file_size: bytes.byteLength });
  }
  return { ok: true, receipts: verified };
}

/**
 * Квитанції будинку за період із посиланнями на перегляд. Що саме видно, вирішує база (RLS):
 * адміністратору — завжди, мешканцям — лише за закритий період. Якщо таблиці ще немає
 * (міграцію не застосовано) — порожній список.
 */
export async function getHouseReceiptViews(periodId: string | null | undefined): Promise<HouseReceiptView[]> {
  if (!periodId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("house_receipts")
    .select("id, storage_path, original_filename, mime_type, file_size, note, created_at")
    .eq("billing_period_id", periodId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getHouseReceiptViews:", error.code, error.message);
    return [];
  }
  type Row = { id: string; storage_path: string; original_filename: string; mime_type: string; file_size: number; note: string | null; created_at: string };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const { data: signed } = await createServiceClient()
    .storage.from(RECEIPTS_BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_TTL_SECONDS);
  return rows.map((r, i) => ({
    id: r.id,
    original_filename: r.original_filename,
    mime_type: r.mime_type,
    file_size: r.file_size,
    created_at: r.created_at,
    attempt_no: 0,
    note: r.note,
    url: signed?.[i]?.signedUrl ? toPublicSupabaseUrl(signed[i]!.signedUrl) : null,
  }));
}

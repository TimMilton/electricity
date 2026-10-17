import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { toPublicSupabaseUrl } from "@/lib/env";
import { MIME_EXTENSION, sanitizeFilename, validateReceiptFile, type ReceiptMime } from "@/lib/files";
import type { AppSettings, Payment, Receipt } from "@/lib/types";

export const RECEIPTS_BUCKET = "receipts";
export const SIGNED_URL_TTL_SECONDS = 300;

export type PlannedUpload = { path: string; name: string };
export type VerifiedReceipt = { storage_path: string; original_filename: string; mime_type: ReceiptMime; file_size: number };

/** Сформувати шляхи для завантаження після перевірки заявлених типу та розміру. */
export function planUploads(
  payment: Pick<Payment, "id" | "apartment_id">,
  files: { name: string; type: string; size: number }[],
  settings: Pick<AppSettings, "allowed_receipt_mime_types" | "max_receipt_size_mb">,
): { ok: true; uploads: (PlannedUpload & { contentType: string })[] } | { ok: false; error: string } {
  if (files.length === 0) return { ok: false, error: "Оберіть файл квитанції" };
  if (files.length > 5) return { ok: false, error: "Можна завантажити до 5 файлів за раз" };
  const uploads: (PlannedUpload & { contentType: string })[] = [];
  for (const f of files) {
    if (!settings.allowed_receipt_mime_types.includes(f.type)) {
      return { ok: false, error: `Файл «${sanitizeFilename(f.name)}»: недозволений формат. Дозволено: PDF, JPEG, PNG, WebP` };
    }
    if (!(f.size > 0) || f.size > settings.max_receipt_size_mb * 1024 * 1024) {
      return { ok: false, error: `Файл «${sanitizeFilename(f.name)}» перевищує ${settings.max_receipt_size_mb} МБ або порожній` };
    }
    const ext = MIME_EXTENSION[f.type as ReceiptMime];
    uploads.push({
      path: `${payment.apartment_id}/${payment.id}/${randomUUID()}.${ext}`,
      name: sanitizeFilename(f.name),
      contentType: f.type,
    });
  }
  return { ok: true, uploads };
}

/**
 * Перевірити файли, які браузер завантажив у Storage:
 * шлях належить платежу, тип визначається за вмістом, розмір — фактичний.
 * Файли, що не пройшли перевірку, видаляються.
 */
export async function verifyUploads(
  supabase: SupabaseClient,
  payment: Pick<Payment, "id" | "apartment_id">,
  uploads: PlannedUpload[],
  settings: Pick<AppSettings, "allowed_receipt_mime_types" | "max_receipt_size_mb">,
): Promise<{ ok: true; receipts: VerifiedReceipt[] } | { ok: false; error: string }> {
  const prefix = `${payment.apartment_id}/${payment.id}/`;
  const verified: VerifiedReceipt[] = [];
  const pathRe = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/;
  for (const u of uploads) {
    if (!u.path.startsWith(prefix) || !pathRe.test(u.path)) {
      return { ok: false, error: "Некоректний шлях до файлу квитанції" };
    }
    const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).download(u.path);
    if (error || !data) {
      return { ok: false, error: "Файл квитанції не знайдено. Завантажте його ще раз" };
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const check = validateReceiptFile(bytes, {
      size: bytes.byteLength,
      maxSizeMb: settings.max_receipt_size_mb,
      allowed: settings.allowed_receipt_mime_types,
    });
    if (!check.ok) {
      await removeObjects([u.path]);
      return { ok: false, error: `«${sanitizeFilename(u.name)}»: ${check.error}` };
    }
    verified.push({
      storage_path: u.path,
      original_filename: sanitizeFilename(u.name),
      mime_type: check.mime,
      file_size: bytes.byteLength,
    });
  }
  return { ok: true, receipts: verified };
}

/** Видалення файлів (лише сервер, сервісний ключ) — для прибирання невдалих завантажень. */
export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await createServiceClient().storage.from(RECEIPTS_BUCKET).remove(paths);
  } catch {
    // не критично: файл без запису в receipts недоступний мешканцям через інтерфейс
  }
}

export type ReceiptView = Pick<Receipt, "id" | "original_filename" | "mime_type" | "file_size" | "created_at" | "attempt_no"> & {
  url: string | null;
};

/** Короткострокові підписані посилання (RLS Storage перевіряє доступ). */
export async function signedReceipts(supabase: SupabaseClient, receipts: Receipt[]): Promise<ReceiptView[]> {
  if (receipts.length === 0) return [];
  const { data } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrls(receipts.map((r) => r.storage_path), SIGNED_URL_TTL_SECONDS);
  return receipts.map((r, i) => ({
    id: r.id,
    original_filename: r.original_filename,
    mime_type: r.mime_type,
    file_size: r.file_size,
    created_at: r.created_at,
    attempt_no: r.attempt_no,
    url: data?.[i]?.signedUrl ? toPublicSupabaseUrl(data[i]!.signedUrl) : null,
  }));
}

export type SignedUpload = PlannedUpload & { contentType: string; token: string };

/**
 * Підписані посилання для завантаження. Створюються від імені користувача,
 * тож Storage перевіряє політику RLS на запис ще під час підписання.
 * Браузер завантажує файл за токеном без сесії та без вшитих у збірку ключів.
 */
export async function signUploads(
  supabase: SupabaseClient,
  uploads: (PlannedUpload & { contentType: string })[],
): Promise<{ ok: true; uploads: SignedUpload[] } | { ok: false; error: string }> {
  const signed: SignedUpload[] = [];
  for (const u of uploads) {
    const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUploadUrl(u.path);
    if (error || !data?.token) {
      return { ok: false, error: "Немає дозволу завантажити квитанцію до цього платежу" };
    }
    signed.push({ ...u, token: data.token });
  }
  return { ok: true, uploads: signed };
}

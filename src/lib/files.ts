/**
 * Перевірка файлів квитанцій за вмістом (сигнатурою), а не лише за розширенням.
 */

export type ReceiptMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export const ALL_RECEIPT_MIME: ReceiptMime[] = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export const MIME_EXTENSION: Record<ReceiptMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MIME_LABEL: Record<ReceiptMime, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
};

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** Визначити тип за першими байтами файлу. */
export function sniffMime(bytes: Uint8Array): ReceiptMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export type FileCheck =
  | { ok: true; mime: ReceiptMime; extension: string }
  | { ok: false; error: string };

export function validateReceiptFile(
  bytes: Uint8Array,
  opts: { size: number; maxSizeMb: number; allowed: string[]; declaredType?: string },
): FileCheck {
  if (opts.size <= 0 || bytes.length === 0) return { ok: false, error: "Файл порожній" };
  if (opts.size > opts.maxSizeMb * 1024 * 1024) {
    return { ok: false, error: `Розмір файлу перевищує ${opts.maxSizeMb} МБ` };
  }
  const mime = sniffMime(bytes);
  if (!mime) return { ok: false, error: "Непідтримуваний формат файлу. Дозволено: PDF, JPEG, PNG, WebP" };
  if (!opts.allowed.includes(mime)) {
    const list = opts.allowed.map((m) => MIME_LABEL[m as ReceiptMime] ?? m).join(", ");
    return { ok: false, error: `Формат ${MIME_LABEL[mime]} не дозволено. Дозволено: ${list}` };
  }
  return { ok: true, mime, extension: MIME_EXTENSION[mime] };
}

/** Безпечне ім'я файлу для збереження в базі (відображення). */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "квитанція").slice(0, 200);
}

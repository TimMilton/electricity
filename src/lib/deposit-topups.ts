import "server-only";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { toPublicSupabaseUrl } from "@/lib/env";
import { planUploads, RECEIPTS_BUCKET, SIGNED_URL_TTL_SECONDS, type PlannedUpload, type ReceiptView } from "@/lib/receipts";
import { verifyServiceUploads } from "@/lib/house-receipts";
import type { AppSettings } from "@/lib/types";

/*
  Окремі внески в депозит (будь-коли, незалежно від показників).
  Файли квитанцій — у приватному бакеті за шляхом topup/<квартира>/<файл>.
*/

export type TopupStatus = "pending_review" | "paid" | "rejected";

export type DepositTopupView = {
  id: string;
  apartment_id: string;
  apartment_number: string | null;
  resident_surname: string | null;
  amount: number | string;
  status: TopupStatus;
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  admin_note: string | null;
  receipts: ReceiptView[];
};

const TOPUP_PATH_RE = /^topup\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/;

export function planTopupUploads(
  apartmentId: string,
  files: { name: string; type: string; size: number }[],
  settings: Pick<AppSettings, "allowed_receipt_mime_types" | "max_receipt_size_mb">,
) {
  return planUploads({ id: apartmentId, apartment_id: "topup" }, files, settings);
}

export function verifyTopupUploads(
  apartmentId: string,
  uploads: PlannedUpload[],
  settings: Pick<AppSettings, "allowed_receipt_mime_types" | "max_receipt_size_mb">,
) {
  return verifyServiceUploads(`topup/${apartmentId}/`, TOPUP_PATH_RE, uploads, settings);
}

/**
 * Внески з квитанціями. Видимість визначає база (RLS): мешканцю — лише своєї
 * квартири, адміністратору — усі. Якщо таблиці ще немає — порожній список.
 */
export async function listDepositTopups(opts: { apartmentId?: string; status?: TopupStatus; limit?: number } = {}): Promise<DepositTopupView[]> {
  const supabase = await createClient();
  let q = supabase
    .from("deposit_topups")
    .select(
      "id, apartment_id, amount, status, note, created_at, reviewed_at, rejection_reason, admin_note, apartments(apartment_number, resident_surname), deposit_topup_receipts(id, storage_path, original_filename, mime_type, file_size, created_at)",
    )
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.apartmentId) q = q.eq("apartment_id", opts.apartmentId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) {
    console.error("listDepositTopups:", error.code, error.message);
    return [];
  }
  type Row = Omit<DepositTopupView, "receipts" | "apartment_number" | "resident_surname"> & {
    apartments: { apartment_number: string; resident_surname: string | null } | null;
    deposit_topup_receipts: { id: string; storage_path: string; original_filename: string; mime_type: string; file_size: number; created_at: string }[];
  };
  const rows = (data ?? []) as unknown as Row[];
  const paths = rows.flatMap((r) => r.deposit_topup_receipts.map((x) => x.storage_path));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await createServiceClient().storage.from(RECEIPTS_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    (signed ?? []).forEach((s, i) => {
      if (s?.signedUrl) urls.set(paths[i]!, toPublicSupabaseUrl(s.signedUrl));
    });
  }
  return rows.map(({ apartments, deposit_topup_receipts, ...r }) => ({
    ...r,
    apartment_number: apartments?.apartment_number ?? null,
    resident_surname: apartments?.resident_surname ?? null,
    receipts: deposit_topup_receipts.map((x) => ({
      id: x.id,
      original_filename: x.original_filename,
      mime_type: x.mime_type,
      file_size: x.file_size,
      created_at: x.created_at,
      attempt_no: 0,
      url: urls.get(x.storage_path) ?? null,
    })),
  }));
}

export type DepositItemStatus = "paid" | "pending_review" | "awaiting_payment" | "rejected";

/** Один внесок у депозит квартири: разом із показниками за місяць або окремий. */
export type DepositItem = {
  key: string;
  kind: "monthly" | "topup";
  /** Для внеску з показниками — місяць, для окремого — null */
  period: { year: number; month: number } | null;
  amount: number | string;
  status: DepositItemStatus;
  date: string;
  confirmedAt: string | null;
  note: string | null;
  rejectionReason: string | null;
  receipts: ReceiptView[];
};

/**
 * Усі внески квартири в депозит: заявлені разом із показниками (місячні платежі)
 * і окремі. «Зараховано» — те, що вже в журналі депозиту (платіж або внесок підтверджено).
 */
export async function listApartmentDepositItems(apartmentId: string): Promise<DepositItem[]> {
  const supabase = await createClient();
  const [{ data, error }, topups] = await Promise.all([
    supabase
      .from("payments")
      .select("id, deposit_contribution, status, created_at, submitted_at, reviewed_at, rejection_reason, billing_periods(year, month)")
      .eq("apartment_id", apartmentId)
      .gt("deposit_contribution", 0),
    listDepositTopups({ apartmentId, limit: 500 }),
  ]);
  if (error) console.error("listApartmentDepositItems:", error.code, error.message);
  type Row = {
    id: string;
    deposit_contribution: number | string;
    status: DepositItemStatus;
    created_at: string;
    submitted_at: string | null;
    reviewed_at: string | null;
    rejection_reason: string | null;
    billing_periods: { year: number; month: number } | null;
  };
  const monthly: DepositItem[] = ((data ?? []) as unknown as Row[]).map((p) => ({
    key: `p-${p.id}`,
    kind: "monthly",
    period: p.billing_periods,
    amount: p.deposit_contribution,
    status: p.status,
    date: p.reviewed_at ?? p.submitted_at ?? p.created_at,
    confirmedAt: p.status === "paid" ? p.reviewed_at : null,
    note: null,
    rejectionReason: p.status === "rejected" ? p.rejection_reason : null,
    receipts: [],
  }));
  const separate: DepositItem[] = topups.map((t) => ({
    key: `t-${t.id}`,
    kind: "topup",
    period: null,
    amount: t.amount,
    status: t.status,
    date: t.created_at,
    confirmedAt: t.status === "paid" ? t.reviewed_at : null,
    note: t.note,
    rejectionReason: t.rejection_reason,
    receipts: t.receipts,
  }));
  return [...monthly, ...separate].sort((a, b) => b.date.localeCompare(a.date));
}

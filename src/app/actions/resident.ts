"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActingContext, getSession } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { dbErrorToResult, zodToResult } from "@/lib/errors";
import { readingSubmissionSchema } from "@/lib/validation";
import { planUploads, removeObjects, signedReceipts, signUploads, verifyUploads, type ReceiptView, type SignedUpload } from "@/lib/receipts";
import { supabasePublicKey, supabasePublicUrl } from "@/lib/env";
import { planTopupUploads, verifyTopupUploads } from "@/lib/deposit-topups";
import { signHouseUploads } from "@/lib/house-receipts";
import type { ActionResult, Payment, PaymentEvent, PeriodTableRow, Receipt } from "@/lib/types";
import { periodLabel } from "@/lib/utils";

const uuid = z.uuid();

function revalidateResident() {
  for (const p of ["/home", "/readings", "/pay", "/residents", "/history"]) revalidatePath(p);
  revalidatePath("/admin", "layout");
}

/**
 * Подання показника та внесків. Квартира визначається сервером із сесії
 * (або з режиму перегляду адміністратора), а не з даних форми.
 */
export async function submitReadingAction(input: unknown): Promise<ActionResult<{ paymentId: string; total: string }>> {
  const ctx = await getActingContext();
  if (!ctx) return { ok: false, error: "Квартиру не визначено" };
  const raw = typeof input === "object" && input ? (input as Record<string, unknown>) : {};
  const parsed = readingSubmissionSchema.safeParse({ ...raw, apartmentId: ctx.apartment.id });
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const d = parsed.data;
  const isAdmin = ctx.session.isAdmin;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_meter_reading", {
    p_apartment_id: d.apartmentId,
    p_period_id: d.periodId,
    p_current_reading: d.currentReading,
    p_deposit_contribution: d.deposit,
    p_hall_lighting: d.hallLighting,
    p_other_amount: d.other,
    p_previous_reading: d.previousReading ?? null,
    p_notes: d.notes ?? null,
    p_reason: isAdmin ? (d.reason ?? null) : null,
    p_acknowledge_downstream: isAdmin ? d.acknowledgeDownstream : false,
  });
  if (error) return dbErrorToResult(error);
  revalidateResident();
  const r = data as { payment: Payment; warnings: string[] };
  return {
    ok: true,
    message: "Показники збережено",
    warnings: r.warnings ?? [],
    data: { paymentId: r.payment.id, total: String(r.payment.total_amount) },
  };
}

async function loadPayment(paymentId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("payments").select("*").eq("id", paymentId).maybeSingle<Payment>();
  return { supabase, payment: data };
}

/** Крок 1 завантаження: сервер перевіряє заявлені файли й видає шляхи у приватному бакеті. */
export async function prepareReceiptUploadAction(
  paymentId: string,
  files: { name: string; type: string; size: number }[],
): Promise<ActionResult<{ storageUrl: string; anonKey: string; uploads: SignedUpload[] }>> {
  if (!uuid.safeParse(paymentId).success) return { ok: false, error: "Некоректний платіж" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Потрібно увійти в систему" };
  const { supabase, payment } = await loadPayment(paymentId); // RLS: лише власний або адміністратор
  if (!payment) return { ok: false, error: "Платіж не знайдено" };
  if (!session.isAdmin && payment.status === "paid") return { ok: false, error: "Платіж уже підтверджено" };
  const settings = await getSettings();
  const plan = planUploads(payment, Array.isArray(files) ? files.slice(0, 10) : [], settings);
  if (!plan.ok) return plan;
  const signed = await signUploads(supabase, plan.uploads);
  if (!signed.ok) return signed;
  // Публічна адреса й anon-ключ не є секретами: вони потрібні браузеру для завантаження за токеном
  return { ok: true, data: { storageUrl: supabasePublicUrl(), anonKey: supabasePublicKey(), uploads: signed.uploads } };
}

const submitSchema = z.object({
  paymentId: uuid,
  confirmed: z.literal(true, { message: "Підтвердьте, що оплату здійснено" }),
  uploads: z.array(z.object({ path: z.string().max(200), name: z.string().max(255) })).min(1, "Завантажте квитанцію").max(5),
});

/** Крок 2: перевірка завантажених файлів і подання платежу на перевірку. */
export async function submitPaymentAction(input: unknown): Promise<ActionResult> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const { paymentId, uploads } = parsed.data;
  const { supabase, payment } = await loadPayment(paymentId);
  if (!payment) return { ok: false, error: "Платіж не знайдено" };
  const settings = await getSettings();
  const verified = await verifyUploads(supabase, payment, uploads, settings);
  if (!verified.ok) {
    await removeObjects(uploads.map((u) => u.path));
    return verified;
  }
  const { error } = await supabase.rpc("submit_payment_for_review", {
    p_payment_id: paymentId,
    p_receipts: verified.receipts,
  });
  if (error) {
    await removeObjects(uploads.map((u) => u.path));
    return dbErrorToResult(error);
  }
  revalidateResident();
  return { ok: true, message: "Платіж надіслано на перевірку" };
}

const entranceSchema = z.object({
  apartmentId: uuid,
  entrance: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
});

/** Під'їзд квартири: мешканець — для своєї, адміністратор — для будь-якої (перевіряє база). */
export async function setEntranceAction(input: unknown): Promise<ActionResult> {
  const parsed = entranceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Оберіть під'їзд: 1, 2 або 3" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Потрібно увійти в систему" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_apartment_entrance", {
    p_apartment_id: parsed.data.apartmentId,
    p_entrance: parsed.data.entrance,
  });
  if (error) return dbErrorToResult(error);
  revalidateResident();
  return { ok: true, message: parsed.data.entrance ? `Під'їзд ${parsed.data.entrance} збережено` : "Під'їзд прибрано" };
}

const addSchema = z.object({
  paymentId: uuid,
  uploads: z.array(z.object({ path: z.string().max(200), name: z.string().max(255) })).min(1).max(5),
});

/** Додати квитанції до платежу (мешканець — до свого на перевірці; адміністратор — до будь-якого). */
export async function addReceiptsAction(input: unknown): Promise<ActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const { paymentId, uploads } = parsed.data;
  const { supabase, payment } = await loadPayment(paymentId);
  if (!payment) return { ok: false, error: "Платіж не знайдено" };
  const settings = await getSettings();
  const verified = await verifyUploads(supabase, payment, uploads, settings);
  if (!verified.ok) {
    await removeObjects(uploads.map((u) => u.path));
    return verified;
  }
  const { error } = await supabase.rpc("add_payment_receipts", { p_payment_id: paymentId, p_receipts: verified.receipts });
  if (error) {
    await removeObjects(uploads.map((u) => u.path));
    return dbErrorToResult(error);
  }
  revalidateResident();
  return { ok: true, message: "Квитанцію додано" };
}

export type ChargeDetails = {
  row: PeriodTableRow;
  periodLabel: string;
  canManage: boolean;
  isAdmin: boolean;
  /** Приватні дані — лише для власної квартири або адміністратора */
  privateInfo: {
    receipts: ReceiptView[];
    rejectionReason: string | null;
    confirmedWithoutReceipt: boolean;
    adminNote: string | null;
    events: PaymentEvent[];
  } | null;
};

/** Деталі нарахування для модального вікна загальної таблиці. */
export async function getChargeDetailsAction(apartmentId: string, periodId: string): Promise<ActionResult<ChargeDetails>> {
  if (!uuid.safeParse(apartmentId).success || !uuid.safeParse(periodId).success) {
    return { ok: false, error: "Некоректний запит" };
  }
  const session = await getSession();
  if (!session) return { ok: false, error: "Потрібно увійти в систему" };
  const supabase = await createClient();
  const [{ data: rows, error }, { data: period }] = await Promise.all([
    supabase.rpc("get_period_table", { p_period_id: periodId }),
    supabase.from("billing_periods").select("year, month").eq("id", periodId).maybeSingle<{ year: number; month: number }>(),
  ]);
  if (error) return dbErrorToResult(error);
  const row = ((rows ?? []) as PeriodTableRow[]).find((r) => r.apartment_id === apartmentId);
  if (!row || !period) return { ok: false, error: "Дані не знайдено" };

  const acting = await getActingContext().catch(() => null);
  const isOwn = row.is_own || (acting?.apartment.id === apartmentId);
  const canManage = session.isAdmin || isOwn;
  let privateInfo: ChargeDetails["privateInfo"] = null;
  if (canManage && row.payment_id) {
    const [{ data: pay }, { data: receipts }, { data: events }] = await Promise.all([
      supabase.from("payments").select("*").eq("id", row.payment_id).maybeSingle<Payment>(),
      supabase.from("receipts").select("*").eq("payment_id", row.payment_id).order("created_at", { ascending: false }),
      supabase.from("payment_events").select("id, event_type, status_after, attempt_no, reason, created_at")
        .eq("payment_id", row.payment_id).order("created_at", { ascending: true }),
    ]);
    if (pay) {
      privateInfo = {
        receipts: await signedReceipts(supabase, (receipts ?? []) as Receipt[]),
        rejectionReason: pay.rejection_reason,
        confirmedWithoutReceipt: pay.confirmed_without_receipt,
        adminNote: session.isAdmin ? pay.admin_note : null,
        events: (events ?? []) as PaymentEvent[],
      };
    }
  }
  return {
    ok: true,
    data: { row, periodLabel: periodLabel(period), canManage, isAdmin: session.isAdmin, privateInfo },
  };
}

// ---------------------------------------------------------------------------
// Окремий внесок у депозит (будь-коли, незалежно від показників)
// ---------------------------------------------------------------------------

/** Крок 1: квартира береться з сесії; сервер перевіряє файли й видає токени завантаження. */
export async function prepareTopupUploadAction(
  files: { name: string; type: string; size: number }[],
): Promise<ActionResult<{ storageUrl: string; anonKey: string; uploads: SignedUpload[] }>> {
  const ctx = await getActingContext();
  if (!ctx) return { ok: false, error: "Квартиру не визначено. Увійдіть знову" };
  if (!ctx.apartment.is_active) return { ok: false, error: "Квартира неактивна. Зверніться до адміністратора" };
  const settings = await getSettings();
  const plan = planTopupUploads(ctx.apartment.id, Array.isArray(files) ? files.slice(0, 10) : [], settings);
  if (!plan.ok) return plan;
  const signed = await signHouseUploads(plan.uploads);
  if (!signed.ok) return signed;
  return { ok: true, data: { storageUrl: supabasePublicUrl(), anonKey: supabasePublicKey(), uploads: signed.uploads } };
}

const topupSchema = z.object({
  amount: z
    .string()
    .trim()
    .transform((v) => v.replace(",", "."))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Вкажіть суму внеску, напр. 150 або 150,50"),
  uploads: z.array(z.object({ path: z.string().max(200), name: z.string().max(255) })).min(1, "Прикріпіть квитанцію").max(10),
  note: z.string().trim().max(500).optional(),
});

/** Крок 2: перевірка файлів за вмістом і подання внеску на перевірку адміністратору. */
export async function submitDepositTopupAction(input: unknown): Promise<ActionResult> {
  const parsed = topupSchema.safeParse(input);
  if (!parsed.success) return zodToResult(parsed.error.issues);
  const ctx = await getActingContext();
  if (!ctx) return { ok: false, error: "Квартиру не визначено. Увійдіть знову" };
  const { amount, uploads, note } = parsed.data;
  const settings = await getSettings();
  const verified = await verifyTopupUploads(ctx.apartment.id, uploads, settings);
  if (!verified.ok) {
    await removeObjects(uploads.map((u) => u.path));
    return verified;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_deposit_topup", {
    p_apartment_id: ctx.apartment.id,
    p_amount: amount,
    p_receipts: verified.receipts,
    p_note: note || null,
  });
  if (error) {
    await removeObjects(uploads.map((u) => u.path));
    return dbErrorToResult(error);
  }
  revalidateResident();
  revalidatePath("/deposit");
  return { ok: true, message: "Внесок надіслано на перевірку адміністратору" };
}

/**
 * Мешканець сам вказує, змінює або видаляє (порожнє значення) прізвище та ім'я своєї квартири.
 * Номер квартири змінює лише адміністратор.
 */
export async function setMyNameAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = z
    .string()
    .trim()
    .max(100, "Не більше 100 символів")
    .safeParse(formData.get("name") ?? "");
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message, fieldErrors: { name: parsed.error.issues[0]!.message } };
  const session = await getSession();
  if (!session) return { ok: false, error: "Потрібно увійти в систему" };
  if (session.isAdmin) return { ok: false, error: "Ім'я квартири змінює її мешканець або адміністратор у розділі «Квартири»" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resident_set_my_name", { p_name: parsed.data });
  if (error) return dbErrorToResult(error);
  revalidateResident();
  revalidatePath("/profile");
  return { ok: true, message: parsed.data ? "Збережено" : "Прізвище та ім'я видалено" };
}

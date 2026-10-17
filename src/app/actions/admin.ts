"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSession, VIEW_AS_COOKIE } from "@/lib/auth";
import { dbErrorToResult, zodToResult } from "@/lib/errors";
import {
  adjustmentSchema,
  apartmentSchema,
  approvePaymentSchema,
  commonReadingSchema,
  depositOperationSchema,
  parseApartmentsCsv,
  periodSchema,
  readingSubmissionSchema,
  rejectPaymentSchema,
  settingsSchema,
  tariffSchema,
} from "@/lib/validation";
import { kyivLocalToIso } from "@/lib/utils";
import { RECEIPTS_BUCKET } from "@/lib/receipts";
import type { ActionResult } from "@/lib/types";

const uuid = z.uuid();
const optionalReason = z.string().trim().max(1000).optional().transform((v) => v || null);
const requiredReason = z.string().trim().min(3, "Вкажіть причину (щонайменше 3 символи)").max(1000);

/** Перевірка ролі на рівні серверної дії (БД перевіряє повторно). */
async function admin() {
  const s = await getSession();
  if (!s?.isAdmin) throw new Error("FORBIDDEN");
  return createClient();
}

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.message === "FORBIDDEN") return { ok: false, error: "Дія доступна лише адміністратору" };
    throw e;
  }
}

function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Режим «Переглянути як мешканець»
// ---------------------------------------------------------------------------
export async function enterViewAsAction(formData: FormData): Promise<void> {
  const s = await getSession();
  if (!s?.isAdmin) redirect("/home");
  const id = uuid.safeParse(formData.get("apartmentId"));
  if (!id.success) redirect("/admin/view-as");
  const supabase = await createClient();
  const { data } = await supabase.from("apartments").select("id").eq("id", id.data).maybeSingle();
  if (!data) redirect("/admin/view-as");
  (await cookies()).set(VIEW_AS_COOKIE, id.data, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 4 });
  redirect("/home");
}

export async function exitViewAsAction(): Promise<void> {
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/admin");
}

// ---------------------------------------------------------------------------
// Платежі
// ---------------------------------------------------------------------------
export async function approvePaymentAction(input: unknown): Promise<ActionResult<{ alreadyPaid: boolean }>> {
  return guard(async () => {
    const parsed = approvePaymentSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { data, error } = await supabase.rpc("approve_payment", { p_payment_id: parsed.data.paymentId, p_note: parsed.data.note ?? null });
    if (error) return dbErrorToResult(error);
    refresh();
    const already = (data as { already_paid: boolean }).already_paid;
    return { ok: true, message: already ? "Платіж уже був підтверджений" : "Оплату підтверджено", data: { alreadyPaid: already } };
  });
}

export async function rejectPaymentAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = rejectPaymentSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("reject_payment", { p_payment_id: parsed.data.paymentId, p_reason: parsed.data.reason });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Платіж відхилено" };
  });
}

// ---------------------------------------------------------------------------
// Квартири, коди, користувачі
// ---------------------------------------------------------------------------
export async function saveApartmentAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = apartmentSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const d = parsed.data;
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_upsert_apartment", {
      p_id: d.id ?? null,
      p_apartment_number: d.apartmentNumber,
      p_resident_surname: d.residentSurname,
      p_is_active: d.isActive,
      p_initial_reading: d.initialReading ?? null,
      p_initial_reading_date: d.initialReadingDate ?? null,
      p_reason: d.reason ?? null,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: d.id ? "Квартиру оновлено" : "Квартиру додано" };
  });
}

export async function importApartmentsAction(csv: string): Promise<ActionResult<{ created: number; updated: number }>> {
  return guard(async () => {
    if (typeof csv !== "string" || csv.length > 500_000) return { ok: false, error: "Файл завеликий" };
    const { rows, errors } = parseApartmentsCsv(csv);
    if (errors.length) return { ok: false, error: errors.slice(0, 5).join("; ") };
    if (rows.length === 0) return { ok: false, error: "У файлі немає рядків із квартирами" };
    const supabase = await admin();
    const { data, error } = await supabase.rpc("admin_import_apartments", { p_rows: rows });
    if (error) return dbErrorToResult(error);
    refresh();
    const r = data as { created: number; updated: number };
    return { ok: true, data: r, message: `Додано ${r.created}, оновлено ${r.updated}` };
  });
}

export async function generateCodeAction(apartmentId: string, allowAdditional: boolean): Promise<ActionResult<{ code: string }>> {
  return guard(async () => {
    if (!uuid.safeParse(apartmentId).success) return { ok: false, error: "Некоректна квартира" };
    const supabase = await admin();
    const { data, error } = await supabase.rpc("admin_generate_registration_code", {
      p_apartment_id: apartmentId,
      p_allow_additional: !!allowAdditional,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, data: { code: String(data) } };
  });
}

export async function generateCodesBulkAction(): Promise<ActionResult<{ codes: { apartment_number: string; resident_surname: string; code: string }[] }>> {
  return guard(async () => {
    const supabase = await admin();
    const { data, error } = await supabase.rpc("admin_generate_codes_bulk");
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, data: { codes: (data ?? []) as { apartment_number: string; resident_surname: string; code: string }[] } };
  });
}

export async function revokeCodeAction(apartmentId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!uuid.safeParse(apartmentId).success) return { ok: false, error: "Некоректна квартира" };
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_revoke_registration_code", { p_apartment_id: apartmentId });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Код скасовано" };
  });
}

export async function setUserActiveAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ profileId: uuid, active: z.boolean(), reason: optionalReason }).safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_set_profile_active", {
      p_profile_id: parsed.data.profileId,
      p_is_active: parsed.data.active,
      p_reason: parsed.data.reason,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: parsed.data.active ? "Користувача активовано" : "Користувача деактивовано" };
  });
}

export async function setUserRoleAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ profileId: uuid, role: z.enum(["resident", "admin"]), reason: requiredReason }).safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_set_profile_role", {
      p_profile_id: parsed.data.profileId,
      p_role: parsed.data.role,
      p_reason: parsed.data.reason,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Роль змінено" };
  });
}

// ---------------------------------------------------------------------------
// Періоди й тарифи
// ---------------------------------------------------------------------------
export async function createPeriodAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = periodSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const d = parsed.data;
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_create_period", {
      p_year: d.year,
      p_month: d.month,
      p_window_start: kyivLocalToIso(d.windowStart),
      p_window_end: kyivLocalToIso(d.windowEnd),
      p_allow_admin_edit_after_close: d.allowAdminEditAfterClose,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Період створено" };
  });
}

export async function createNextPeriodAction(): Promise<ActionResult> {
  return guard(async () => {
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_create_next_period");
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Наступний період створено з типовими датами" };
  });
}

export async function updatePeriodAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z
      .object({
        periodId: uuid,
        windowStart: z.string().min(1),
        windowEnd: z.string().min(1),
        allowAdminEditAfterClose: z.boolean(),
        reason: optionalReason,
      })
      .safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const d = parsed.data;
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_update_period", {
      p_period_id: d.periodId,
      p_window_start: kyivLocalToIso(d.windowStart),
      p_window_end: kyivLocalToIso(d.windowEnd),
      p_allow_admin_edit_after_close: d.allowAdminEditAfterClose,
      p_reason: d.reason,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Період оновлено" };
  });
}

export async function closePeriodAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ periodId: uuid, reason: optionalReason }).safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_close_period", { p_period_id: parsed.data.periodId, p_reason: parsed.data.reason });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Приймання показників закрито" };
  });
}

export async function reopenPeriodAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ periodId: uuid, windowEnd: z.string().min(1), reason: requiredReason }).safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_reopen_period", {
      p_period_id: parsed.data.periodId,
      p_new_window_end: kyivLocalToIso(parsed.data.windowEnd),
      p_reason: parsed.data.reason,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Приймання показників відкрито повторно" };
  });
}

export async function setTariffAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = tariffSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_set_tariff", {
      p_rate: parsed.data.rate,
      p_valid_from: parsed.data.validFrom,
      p_reason: parsed.data.reason ?? null,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Тариф збережено. Раніше внесені нарахування не змінено" };
  });
}

export async function deleteFutureTariffAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ tariffId: uuid, reason: optionalReason }).safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_delete_future_tariff", { p_tariff_id: parsed.data.tariffId, p_reason: parsed.data.reason });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Майбутній тариф видалено" };
  });
}

// ---------------------------------------------------------------------------
// Показники від імені мешканця (з будь-якої квартири)
// ---------------------------------------------------------------------------
export async function adminSubmitReadingAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z
      .object({
        apartmentId: uuid,
        periodId: uuid,
        currentReading: z.string(),
        previousReading: z.string().optional(),
        deposit: z.string().optional(),
        hallLighting: z.string().optional(),
        other: z.string().optional(),
        reason: optionalReason,
        acknowledgeDownstream: z.boolean().optional(),
      })
      .safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const v = readingSubmissionSchema.safeParse({
      ...parsed.data,
      previousReading: parsed.data.previousReading || undefined,
      deposit: parsed.data.deposit ?? "",
      hallLighting: parsed.data.hallLighting ?? "",
      other: parsed.data.other ?? "",
      reason: parsed.data.reason ?? undefined,
    });
    if (!v.success) return zodToResult(v.error.issues);
    const d = v.data;
    const supabase = await admin();
    const { data, error } = await supabase.rpc("submit_meter_reading", {
      p_apartment_id: d.apartmentId,
      p_period_id: d.periodId,
      p_current_reading: d.currentReading,
      p_deposit_contribution: d.deposit,
      p_hall_lighting: d.hallLighting,
      p_other_amount: d.other,
      p_previous_reading: d.previousReading ?? null,
      p_notes: null,
      p_reason: d.reason ?? null,
      p_acknowledge_downstream: d.acknowledgeDownstream,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Показник збережено", warnings: (data as { warnings: string[] }).warnings ?? [] };
  });
}

// ---------------------------------------------------------------------------
// Загальний лічильник, розбіжності, депозит
// ---------------------------------------------------------------------------
export async function saveCommonReadingAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = commonReadingSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const d = parsed.data;
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_upsert_common_reading", {
      p_period_id: d.periodId,
      p_current_reading: d.currentReading,
      p_previous_reading: d.previousReading ?? null,
      p_notes: d.notes ?? null,
      p_reason: d.reason ?? null,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Показник загального лічильника збережено, розбіжність перераховано" };
  });
}

export async function recalculateReconciliationAction(periodId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!uuid.safeParse(periodId).success) return { ok: false, error: "Некоректний період" };
    const supabase = await admin();
    const { error } = await supabase.rpc("calculate_reconciliation", { p_period_id: periodId });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Розбіжність перераховано" };
  });
}

export async function reviewReconciliationAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ id: uuid, explanation: optionalReason }).safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_review_reconciliation", { p_reconciliation_id: parsed.data.id, p_explanation: parsed.data.explanation });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Розбіжність позначено як перевірену" };
  });
}

export async function closeReconciliationAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ id: uuid, explanation: optionalReason }).safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_close_reconciliation", { p_reconciliation_id: parsed.data.id, p_explanation: parsed.data.explanation });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Розбіжність закрито" };
  });
}

export async function applyAdjustmentAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = adjustmentSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_apply_deposit_adjustment", {
      p_reconciliation_id: parsed.data.reconciliationId,
      p_amount: parsed.data.amount,
      p_description: parsed.data.description,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Кошти депозиту використано, операцію записано в журнал" };
  });
}

export async function depositOperationAction(input: unknown): Promise<ActionResult> {
  return guard(async () => {
    const parsed = depositOperationSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const d = parsed.data;
    const supabase = await admin();
    const { error } = await supabase.rpc("admin_create_deposit_operation", {
      p_type: d.type,
      p_amount: d.amount,
      p_description: d.description,
      p_period_id: d.periodId,
      p_apartment_id: d.apartmentId ?? null,
    });
    if (error) return dbErrorToResult(error);
    refresh();
    return { ok: true, message: "Операцію записано в журнал депозиту" };
  });
}

// ---------------------------------------------------------------------------
// Налаштування
// ---------------------------------------------------------------------------
export async function saveSettingsAction(input: unknown, reason?: string): Promise<ActionResult> {
  return guard(async () => {
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return zodToResult(parsed.error.issues);
    const d = parsed.data;
    const supabase = await admin();
    const payload = {
      ...d,
      anomaly_threshold_kwh: d.anomaly_threshold_kwh.replace(",", "."),
      anomaly_multiplier: d.anomaly_multiplier.replace(",", "."),
    };
    const { error } = await supabase.rpc("admin_update_settings", { p_settings: payload, p_reason: reason?.trim() || null });
    if (error) return dbErrorToResult(error);
    // Синхронізація обмежень бакета з налаштуваннями (додатковий рівень захисту)
    try {
      await createServiceClient().storage.updateBucket(RECEIPTS_BUCKET, {
        public: false,
        fileSizeLimit: d.max_receipt_size_mb * 1024 * 1024,
        allowedMimeTypes: d.allowed_receipt_mime_types,
      });
    } catch {
      // не блокує збереження: сервер однаково перевіряє файли
    }
    refresh();
    return { ok: true, message: "Налаштування збережено" };
  });
}

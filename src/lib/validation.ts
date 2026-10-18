import { z } from "zod";
import { MONEY_SCALE, READING_SCALE, TARIFF_SCALE, parseScaled, toDecimalString } from "./money";

/** Максимальна сума одного внеску на рівні системи (додатково — ліміт у налаштуваннях БД). */
export const SYSTEM_MAX_CONTRIBUTION = 100000;

function decimalField(opts: {
  scale: number;
  label: string;
  min?: number;
  max?: number;
  allowEmptyAsZero?: boolean;
  positive?: boolean;
}) {
  return z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const raw = typeof v === "number" ? String(v) : v.trim();
      if (raw === "") {
        if (opts.allowEmptyAsZero) return toDecimalString(0n, opts.scale);
        ctx.addIssue({ code: "custom", message: `Вкажіть: ${opts.label}` });
        return z.NEVER;
      }
      let scaled: bigint;
      try {
        scaled = parseScaled(raw, opts.scale);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: `${opts.label}: ${(e as Error).message.toLowerCase()}` });
        return z.NEVER;
      }
      const unit = 10n ** BigInt(opts.scale);
      if (opts.positive && scaled <= 0n) {
        ctx.addIssue({ code: "custom", message: `${opts.label}: має бути більше нуля` });
        return z.NEVER;
      }
      if (opts.min !== undefined && scaled < BigInt(opts.min) * unit) {
        ctx.addIssue({ code: "custom", message: `${opts.label}: не може бути від'ємним` });
        return z.NEVER;
      }
      if (opts.max !== undefined && scaled > BigInt(opts.max) * unit) {
        ctx.addIssue({ code: "custom", message: `${opts.label}: перевищує допустиме значення` });
        return z.NEVER;
      }
      return toDecimalString(scaled, opts.scale);
    });
}

export const readingValue = (label: string) =>
  decimalField({ scale: READING_SCALE, label, min: 0, max: 9_999_999_999 });

export const moneyValue = (label: string) =>
  decimalField({ scale: MONEY_SCALE, label, min: 0, max: SYSTEM_MAX_CONTRIBUTION, allowEmptyAsZero: true });

export const tariffValue = decimalField({ scale: TARIFF_SCALE, label: "Тариф", positive: true, max: 1000 });

const uuid = z.uuid({ message: "Некоректний ідентифікатор" });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не більше ${max} символів`)
    .optional()
    .transform((v) => (v ? v : undefined));
const requiredReason = z.string().trim().min(3, "Вкажіть причину (щонайменше 3 символи)").max(1000);

export const readingSubmissionSchema = z.object({
  apartmentId: uuid,
  periodId: uuid,
  currentReading: readingValue("Поточний показник"),
  previousReading: readingValue("Попередній показник").optional(),
  deposit: moneyValue("Депозит"),
  hallLighting: moneyValue("Освітлення під'їзду"),
  other: moneyValue("Інші внески"),
  notes: optionalText(1000),
  reason: optionalText(1000),
  acknowledgeDownstream: z.boolean().optional().default(false),
});
export type ReadingSubmission = z.infer<typeof readingSubmissionSchema>;

const passwordSchema = z
  .string()
  .min(8, "Пароль має містити щонайменше 8 символів")
  .max(72, "Пароль задовгий")
  .regex(/[A-Za-zА-Яа-яІіЇїЄєҐґ]/, "Пароль має містити літери")
  .regex(/\d/, "Пароль має містити цифри");

export const registrationSchema = z
  .object({
    apartmentNumber: z.string().trim().min(1, "Вкажіть номер квартири").max(20),
    surname: z.string().trim().min(2, "Вкажіть прізвище").max(100),
    email: z.email("Некоректна електронна пошта").trim().toLowerCase().max(254),
    password: passwordSchema,
    passwordConfirm: z.string(),
    code: z.string().trim().max(32).optional().default(""),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Паролі не збігаються",
  });
export type RegistrationInput = z.input<typeof registrationSchema>;

export const loginSchema = z.object({
  email: z.email("Некоректна електронна пошта").trim().toLowerCase(),
  password: z.string().min(1, "Вкажіть пароль"),
});

export const forgotPasswordSchema = z.object({
  email: z.email("Некоректна електронна пошта").trim().toLowerCase(),
});

export const resetPasswordSchema = z
  .object({ password: passwordSchema, passwordConfirm: z.string() })
  .refine((d) => d.password === d.passwordConfirm, { path: ["passwordConfirm"], message: "Паролі не збігаються" });

export const approvePaymentSchema = z.object({
  paymentId: uuid,
  note: optionalText(1000),
});

export const rejectPaymentSchema = z.object({
  paymentId: uuid,
  reason: requiredReason,
});

export const periodSchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    windowStart: z.string().min(1, "Вкажіть дату відкриття"),
    windowEnd: z.string().min(1, "Вкажіть дату закриття"),
    allowAdminEditAfterClose: z.boolean().default(true),
  })
  .refine((d) => new Date(d.windowEnd) > new Date(d.windowStart), {
    path: ["windowEnd"],
    message: "Дата закриття має бути пізнішою за дату відкриття",
  });

export const tariffSchema = z.object({
  rate: tariffValue,
  validFrom: z.iso.date("Вкажіть дату початку дії"),
  reason: optionalText(1000),
});

export const apartmentSchema = z.object({
  id: uuid.optional(),
  apartmentNumber: z.string().trim().min(1, "Вкажіть номер").max(20),
  residentSurname: z.string().trim().min(1, "Вкажіть прізвище").max(100),
  isActive: z.boolean().default(true),
  initialReading: readingValue("Початковий показник").optional(),
  initialReadingDate: z.iso.date().optional(),
  reason: optionalText(1000),
});

export const commonReadingSchema = z.object({
  periodId: uuid,
  currentReading: readingValue("Поточний показник"),
  previousReading: readingValue("Попередній показник").optional(),
  notes: optionalText(1000),
  reason: optionalText(1000),
  acknowledge: z.boolean().optional().default(false),
});

export const depositOperationSchema = z.object({
  type: z.enum(["correction", "refund"]),
  amount: decimalField({ scale: MONEY_SCALE, label: "Сума", max: 10_000_000 }),
  description: z.string().trim().min(3, "Вкажіть підставу операції").max(1000),
  periodId: uuid,
  apartmentId: uuid.optional(),
});

export const adjustmentSchema = z.object({
  reconciliationId: uuid,
  amount: decimalField({ scale: MONEY_SCALE, label: "Сума", positive: true, max: 10_000_000 }),
  description: z.string().trim().min(3, "Вкажіть підставу використання депозиту").max(1000),
});

export const settingsSchema = z
  .object({
    envelope_url: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "Посилання має починатися з https://"),
    max_receipt_size_mb: z.coerce.number().int().min(1).max(50),
    allowed_receipt_mime_types: z
      .array(z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]))
      .min(1, "Оберіть хоча б один формат"),
    show_deposit_balance_to_residents: z.boolean(),
    other_charges_enabled: z.boolean(),
    max_contribution_amount: decimalField({ scale: MONEY_SCALE, label: "Ліміт внеску", positive: true, max: SYSTEM_MAX_CONTRIBUTION }),
    registration_open: z.boolean(),
    registration_code_required: z.boolean(),
    registration_code_max_attempts: z.coerce.number().int().min(1).max(50),
    registration_lockout_minutes: z.coerce.number().int().min(1).max(10080),
    default_window_start_day: z.coerce.number().int().min(1).max(28),
    default_window_start_hour: z.coerce.number().int().min(0).max(23),
    default_window_end_day: z.coerce.number().int().min(1).max(28),
    default_window_end_hour: z.coerce.number().int().min(0).max(23),
    window_for_previous_month: z.boolean(),
    admin_edit_after_close: z.boolean(),
    anomaly_threshold_kwh: z.string().trim().refine((v) => v === "" || /^\d+([.,]\d{1,2})?$/.test(v), "Некоректне значення"),
    anomaly_multiplier: z.string().trim().refine((v) => v === "" || (/^\d+([.,]\d{1,2})?$/.test(v) && Number(v.replace(",", ".")) > 1), "Має бути більше 1"),
    deposit_public_note: z.string().trim().max(2000),
  })
  .refine(
    (d) =>
      d.default_window_end_day > d.default_window_start_day ||
      (d.default_window_end_day === d.default_window_start_day && d.default_window_end_hour >= d.default_window_start_hour),
    { path: ["default_window_end_day"], message: "Закриття має бути пізніше за відкриття" },
  );

export const importRowSchema = z.object({
  apartment_number: z.string().trim().min(1).max(20),
  resident_surname: z.string().trim().min(1).max(100),
  initial_reading: readingValue("Початковий показник").optional(),
});

/** Розбір CSV зі списком квартир: «номер;прізвище[;початковий показник]». */
export function parseApartmentsCsv(text: string): { rows: z.infer<typeof importRowSchema>[]; errors: string[] } {
  const rows: z.infer<typeof importRowSchema>[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const sample = lines.find((l) => l.trim()) ?? "";
  const delimiter = sample.includes(";") ? ";" : sample.includes("\t") ? "\t" : ",";
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const cells = trimmed.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /номер|квартир|apartment/i.test(cells[0] ?? "")) return; // заголовок
    const parsed = importRowSchema.safeParse({
      apartment_number: cells[0] ?? "",
      resident_surname: cells[1] ?? "",
      initial_reading: cells[2] ? cells[2] : undefined,
    });
    if (parsed.success) rows.push(parsed.data);
    else errors.push(`Рядок ${i + 1}: ${parsed.error.issues[0]?.message ?? "помилка"}`);
  });
  return { rows, errors };
}

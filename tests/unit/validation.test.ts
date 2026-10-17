import { describe, expect, it } from "vitest";
import { parseApartmentsCsv, readingSubmissionSchema, registrationSchema, settingsSchema } from "@/lib/validation";
import { sanitizeFilename, sniffMime, validateReceiptFile } from "@/lib/files";
import { csvCell, toCsv } from "@/lib/csv";
import { kyivLocalToIso, toKyivLocalInput } from "@/lib/utils";
import { periodPhase } from "@/lib/period";
import type { BillingPeriod } from "@/lib/types";

const id = "11111111-1111-4111-8111-111111111111";

describe("Валідація показників і внесків (Zod)", () => {
  it("приймає коректні значення та нормалізує точність", () => {
    const r = readingSubmissionSchema.parse({ apartmentId: id, periodId: id, currentReading: "1234,5", deposit: "", hallLighting: "15", other: "0" });
    expect(r).toMatchObject({ currentReading: "1234.50", deposit: "0.00", hallLighting: "15.00", other: "0.00" });
  });

  it("відхиляє від'ємні, нечислові, зайву точність і перевищення ліміту", () => {
    for (const bad of [
      { currentReading: "-1" },
      { currentReading: "abc" },
      { currentReading: "" },
      { currentReading: "1", deposit: "1.001" },
      { currentReading: "1", hallLighting: "-5" },
      { currentReading: "1", deposit: "100001" },
    ]) {
      const res = readingSubmissionSchema.safeParse({ apartmentId: id, periodId: id, deposit: "", hallLighting: "", other: "", ...bad });
      expect(res.success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("реєстрація: пароль, підтвердження, пошта", () => {
    const ok = registrationSchema.safeParse({
      apartmentNumber: "12", surname: "Петренко", email: "Test@Example.com", password: "secret123", passwordConfirm: "secret123", code: "ABCDE-12345",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.email).toBe("test@example.com");
    const mismatch = registrationSchema.safeParse({
      apartmentNumber: "12", surname: "Петренко", email: "a@b.ua", password: "secret123", passwordConfirm: "secret124",
    });
    expect(mismatch.success).toBe(false);
    const weak = registrationSchema.safeParse({ apartmentNumber: "12", surname: "П", email: "a@b.ua", password: "short", passwordConfirm: "short" });
    expect(weak.success).toBe(false);
  });

  it("налаштування: посилання на конверт лише https", () => {
    const base = {
      envelope_url: "https://send.monobank.ua/jar/x", max_receipt_size_mb: 10, allowed_receipt_mime_types: ["application/pdf"],
      show_deposit_balance_to_residents: true, other_charges_enabled: false, max_contribution_amount: "10000", registration_open: true,
      registration_code_required: true, registration_code_max_attempts: 5, registration_lockout_minutes: 30, default_window_start_day: 1,
      default_window_start_hour: 0, default_window_end_day: 5, default_window_end_hour: 23, window_for_previous_month: true,
      admin_edit_after_close: true, anomaly_threshold_kwh: "", anomaly_multiplier: "", deposit_public_note: "",
    };
    expect(settingsSchema.safeParse(base).success).toBe(true);
    expect(settingsSchema.safeParse({ ...base, envelope_url: "http://x.ua" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, envelope_url: "javascript:alert(1)" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, default_window_end_day: 1, default_window_start_day: 5 }).success).toBe(false);
  });

  it("імпорт квартир із CSV з різними роздільниками", () => {
    const r = parseApartmentsCsv("﻿Номер;Прізвище;Показник\n1;Іваненко;123,5\n2;Петренко\n\n");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { apartment_number: "1", resident_surname: "Іваненко", initial_reading: "123.50" },
      { apartment_number: "2", resident_surname: "Петренко" },
    ]);
    const bad = parseApartmentsCsv("1,\n");
    expect(bad.errors.length).toBe(1);
  });
});

describe("13. Перевірка файлів квитанцій за вмістом", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n...");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const exeRenamed = new Uint8Array([0x4d, 0x5a, 0x90, 0]);
  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

  it("визначає тип за сигнатурою, а не за розширенням", () => {
    expect(sniffMime(pdf)).toBe("application/pdf");
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(jpg)).toBe("image/jpeg");
    expect(sniffMime(webp)).toBe("image/webp");
    expect(sniffMime(exeRenamed)).toBeNull();
    expect(sniffMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("перевіряє розмір і дозволені формати", () => {
    expect(validateReceiptFile(pdf, { size: pdf.length, maxSizeMb: 10, allowed })).toMatchObject({ ok: true, mime: "application/pdf", extension: "pdf" });
    expect(validateReceiptFile(exeRenamed, { size: 4, maxSizeMb: 10, allowed })).toMatchObject({ ok: false });
    expect(validateReceiptFile(pdf, { size: 11 * 1024 * 1024, maxSizeMb: 10, allowed })).toMatchObject({ ok: false });
    expect(validateReceiptFile(webp, { size: webp.length, maxSizeMb: 10, allowed: ["application/pdf"] })).toMatchObject({ ok: false });
    expect(validateReceiptFile(new Uint8Array(), { size: 0, maxSizeMb: 10, allowed })).toMatchObject({ ok: false });
  });

  it("очищує ім'я файлу", () => {
    expect(sanitizeFilename('../../etc/passwd<script>"')).toBe(".._.._etc_passwd_script__");
    expect(sanitizeFilename("   ")).toBe("квитанція");
  });
});

describe("CSV-експорт", () => {
  it("екранує роздільники та захищає від формульних ін'єкцій", () => {
    expect(csvCell('Іван "Іваненко"; кв. 1')).toBe('"Іван ""Іваненко""; кв. 1"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-127,44")).toBe("-127,44");
    expect(csvCell("+380")).toBe("'+380");
    expect(toCsv([["a", 1], [null, "b"]])).toBe("﻿a;1\r\n;b\r\n");
  });
});

describe("Дати та вікно приймання (Europe/Kyiv)", () => {
  it("перетворює київський локальний час з урахуванням літнього/зимового часу", () => {
    expect(kyivLocalToIso("2026-07-01T00:00")).toBe("2026-06-30T21:00:00.000Z"); // UTC+3
    expect(kyivLocalToIso("2026-01-05T23:59")).toBe("2026-01-05T21:59:00.000Z"); // UTC+2
    expect(toKyivLocalInput("2026-06-30T21:00:00.000Z")).toBe("2026-07-01T00:00");
  });

  it("7. визначає фазу вікна приймання", () => {
    const p = (start: number, end: number, status: BillingPeriod["status"] = "open"): BillingPeriod => ({
      id: id, year: 2026, month: 9, start_date: "2026-09-01", end_date: "2026-09-30",
      reading_window_start: new Date(Date.now() + start).toISOString(),
      reading_window_end: new Date(Date.now() + end).toISOString(),
      status, allow_admin_edit_after_close: true, closed_at: null,
    });
    expect(periodPhase(p(-1000, 1000))).toBe("open");
    expect(periodPhase(p(1000, 2000, "scheduled"))).toBe("before");
    expect(periodPhase(p(-2000, -1000))).toBe("after");
    expect(periodPhase(p(-1000, 1000, "closed"))).toBe("closed");
  });
});

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const KYIV = "Europe/Kyiv";

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: KYIV,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? value + "T12:00:00Z" : value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: KYIV, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export const MONTHS = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень",
];

export const MONTHS_GENITIVE = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
];

export function periodLabel(p: { year: number; month: number }): string {
  return `${MONTHS[p.month - 1]} ${p.year}`;
}

/** Значення для <input type="datetime-local"> у київському часі. */
export function toKyivLocalInput(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Перетворити київський локальний час "YYYY-MM-DDTHH:mm" у ISO (UTC). */
export function kyivLocalToIso(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) throw new Error("Некоректна дата");
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  // Підбір зміщення: спочатку вважаємо UTC, потім коригуємо на фактичне зміщення Києва
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  const offsetAt = (ts: number) => {
    const local = toKyivLocalInput(new Date(ts));
    const [dt, tm] = local.split("T");
    const [yy, mm, dd] = dt!.split("-").map(Number);
    const [hh, mn] = tm!.split(":").map(Number);
    return Date.UTC(yy!, mm! - 1, dd!, hh!, mn!) - ts;
  };
  let ts = guess - offsetAt(guess);
  ts = guess - offsetAt(ts);
  return new Date(ts).toISOString();
}

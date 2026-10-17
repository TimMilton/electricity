/**
 * Точна десяткова арифметика для фінансових розрахунків.
 *
 * Значення зберігаються як BigInt у мінімальних одиницях:
 *   гроші      — копійки (scale 2)
 *   показники  — сотні частки кВт·год (scale 2)
 *   тариф      — scale 4
 *
 * Округлення — «половина від нуля», як round(numeric, 2) у PostgreSQL,
 * тож попередній розрахунок у браузері збігається з серверним.
 * Джерелом істини залишається сервер (функції БД).
 */

export const MONEY_SCALE = 2;
export const READING_SCALE = 2;
export const TARIFF_SCALE = 4;

const DECIMAL_RE = /^(-)?(\d+)(?:[.,](\d+))?$/;

export class DecimalParseError extends Error {}

/** Розібрати десятковий рядок у ціле число з заданою кількістю знаків. Відкидає зайву точність. */
export function parseScaled(input: string | number, scale: number): bigint {
  const raw = typeof input === "number" ? numberToPlain(input) : input.trim().replace(/\s+/g, "");
  const m = DECIMAL_RE.exec(raw);
  if (!m) throw new DecimalParseError("Введіть число");
  const [, sign, intPart, fracPart = ""] = m;
  if (fracPart.length > scale) {
    throw new DecimalParseError(`Не більше ${scale} знаків після коми`);
  }
  const value = BigInt(intPart + fracPart.padEnd(scale, "0"));
  return sign ? -value : value;
}

export function tryParseScaled(input: string | number | null | undefined, scale: number): bigint | null {
  if (input === null || input === undefined || (typeof input === "string" && input.trim() === "")) return null;
  try {
    return parseScaled(input, scale);
  } catch {
    return null;
  }
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new DecimalParseError("Введіть число");
  // toFixed(10) уникає експоненційного запису; зайві нулі прибираємо
  return n.toFixed(10).replace(/\.?0+$/, "");
}

/** Ділення з округленням «половина від нуля». */
export function divRoundHalfAwayFromZero(numerator: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) throw new RangeError("divisor must be positive");
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = abs / divisor;
  const r = abs % divisor;
  const rounded = r * 2n >= divisor ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Перетворити значення зі scale `from` у scale `to` з округленням. */
export function rescale(value: bigint, from: number, to: number): bigint {
  if (to === from) return value;
  if (to > from) return value * 10n ** BigInt(to - from);
  return divRoundHalfAwayFromZero(value, 10n ** BigInt(from - to));
}

/** Рядок для передачі в PostgreSQL numeric: "1234.50" */
export function toDecimalString(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const intPart = abs.slice(0, abs.length - scale);
  const frac = scale > 0 ? "." + abs.slice(abs.length - scale) : "";
  return (negative ? "-" : "") + intPart + frac;
}

/** K = P_current − P_prev (scale 2) */
export function consumption(previous: bigint, current: bigint): bigint {
  return current - previous;
}

/** E = K × T, округлено до копійок. consumption — scale 2, tariff — scale 4. */
export function electricityAmount(consumptionScaled: bigint, tariffScaled: bigint): bigint {
  // scale 2 + scale 4 = scale 6 → копійки (scale 2)
  return divRoundHalfAwayFromZero(consumptionScaled * tariffScaled, 10n ** 4n);
}

/** Total = Electricity + Deposit + HallLighting + Other (усе в копійках). */
export function totalAmount(parts: { electricity: bigint; deposit: bigint; hallLighting: bigint; other: bigint }): bigint {
  return parts.electricity + parts.deposit + parts.hallLighting + parts.other;
}

export type ChargeBreakdown = {
  previous: bigint;
  current: bigint;
  consumption: bigint;
  tariff: bigint;
  electricity: bigint;
  deposit: bigint;
  hallLighting: bigint;
  other: bigint;
  total: bigint;
};

export type CalcInput = {
  previous: string | number;
  current: string | number;
  tariff: string | number;
  deposit?: string | number | null;
  hallLighting?: string | number | null;
  other?: string | number | null;
};

export type CalcResult = { ok: true; value: ChargeBreakdown } | { ok: false; error: string };

/** Повний розрахунок нарахування (для попереднього перегляду та перевірок). */
export function calculateCharge(input: CalcInput): CalcResult {
  try {
    const previous = parseScaled(input.previous, READING_SCALE);
    const current = parseScaled(input.current, READING_SCALE);
    const tariff = parseScaled(input.tariff, TARIFF_SCALE);
    const deposit = tryParseScaled(input.deposit ?? 0, MONEY_SCALE) ?? 0n;
    const hallLighting = tryParseScaled(input.hallLighting ?? 0, MONEY_SCALE) ?? 0n;
    const other = tryParseScaled(input.other ?? 0, MONEY_SCALE) ?? 0n;

    if (previous < 0n || current < 0n) return { ok: false, error: "Показники не можуть бути від'ємними" };
    if (tariff <= 0n) return { ok: false, error: "Тариф не визначено" };
    if (current < previous) {
      return {
        ok: false,
        error: "Поточний показник менший за попередній. Автоматичний розрахунок неможливий — зверніться до адміністратора",
      };
    }
    if (deposit < 0n || hallLighting < 0n || other < 0n) {
      return { ok: false, error: "Суми внесків не можуть бути від'ємними" };
    }
    const k = consumption(previous, current);
    const electricity = electricityAmount(k, tariff);
    const total = totalAmount({ electricity, deposit, hallLighting, other });
    return {
      ok: true,
      value: { previous, current, consumption: k, tariff, electricity, deposit, hallLighting, other, total },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Помилка розрахунку" };
  }
}

/** Розбіжність: DiscrepancyKWh = CommonConsumption − ApartmentConsumption (scale 2). */
export function discrepancy(commonConsumption: bigint, apartmentConsumptions: bigint[]): {
  apartmentTotal: bigint;
  discrepancy: bigint;
  absolute: bigint;
} {
  const apartmentTotal = apartmentConsumptions.reduce((a, b) => a + b, 0n);
  const d = commonConsumption - apartmentTotal;
  return { apartmentTotal, discrepancy: d, absolute: d < 0n ? -d : d };
}

/** DepositBalance = Sum(Contributions) − Sum(Adjustments) + Sum(Corrections) − Sum(Refunds).
 *  Записи журналу зберігаються зі знаком, тож баланс — проста сума. */
export function depositBalance(entries: { type: string; amount: bigint }[]): bigint {
  return entries.reduce((sum, e) => sum + e.amount, 0n);
}

// ---------------------------------------------------------------------------
// Форматування для інтерфейсу
// ---------------------------------------------------------------------------

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatScaled(value: bigint, scale: number, minFraction = scale): string {
  const s = toDecimalString(value, scale);
  const negative = s.startsWith("-");
  const [intPart = "0", frac = ""] = (negative ? s.slice(1) : s).split(".");
  let f = frac;
  while (f.length > minFraction && f.endsWith("0")) f = f.slice(0, -1);
  return (negative ? "−" : "") + groupThousands(intPart) + (f ? "," + f : "");
}

/** Значення з БД (numeric приходить рядком) → BigInt зі scale. */
export function fromDb(value: string | number | null | undefined, scale: number): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  const s = typeof value === "number" ? numberToPlain(value) : value;
  const m = DECIMAL_RE.exec(s);
  if (!m) return null;
  const [, sign, intPart, fracPart = ""] = m;
  const padded = (fracPart + "0".repeat(scale)).slice(0, scale);
  let v = BigInt(intPart + padded);
  // округлити, якщо в базі більша точність
  if (fracPart.length > scale) {
    const extra = BigInt(intPart + fracPart);
    v = divRoundHalfAwayFromZero(extra, 10n ** BigInt(fracPart.length - scale));
  }
  return sign ? -v : v;
}

export function formatMoney(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const v = typeof value === "bigint" ? value : fromDb(value, MONEY_SCALE);
  if (v === null) return "—";
  return formatScaled(v, MONEY_SCALE) + " грн";
}

export function formatKwh(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const v = typeof value === "bigint" ? value : fromDb(value, READING_SCALE);
  if (v === null) return "—";
  return formatScaled(v, READING_SCALE, 0) + " кВт·год";
}

export function formatReading(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const v = typeof value === "bigint" ? value : fromDb(value, READING_SCALE);
  if (v === null) return "—";
  return formatScaled(v, READING_SCALE, 0);
}

export function formatTariff(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const v = typeof value === "bigint" ? value : fromDb(value, TARIFF_SCALE);
  if (v === null) return "—";
  return formatScaled(v, TARIFF_SCALE, 2) + " грн/кВт·год";
}

/** Для CSV: число з крапкою без групування. */
export function plainDecimal(value: string | number | null | undefined, scale: number): string {
  const v = fromDb(value, scale);
  return v === null ? "" : toDecimalString(v, scale).replace(".", ",");
}

/** Тариф без одиниць (для щільних таблиць). */
export function formatRate(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const v = typeof value === "bigint" ? value : fromDb(value, TARIFF_SCALE);
  if (v === null) return "—";
  return formatScaled(v, TARIFF_SCALE, 2);
}

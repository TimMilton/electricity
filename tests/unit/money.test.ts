import { describe, expect, it } from "vitest";
import {
  calculateCharge,
  consumption,
  depositBalance,
  discrepancy,
  divRoundHalfAwayFromZero,
  electricityAmount,
  formatKwh,
  formatMoney,
  fromDb,
  parseScaled,
  plainDecimal,
  toDecimalString,
  totalAmount,
} from "@/lib/money";

describe("Точна десяткова арифметика", () => {
  it("розбирає десяткові рядки з крапкою та комою без втрати точності", () => {
    expect(parseScaled("123,45", 2)).toBe(12345n);
    expect(parseScaled("0.1", 2)).toBe(10n);
    expect(parseScaled(" 1 000.5 ", 2)).toBe(100050n);
    expect(parseScaled("4.32", 4)).toBe(43200n);
    expect(() => parseScaled("1.005", 2)).toThrow(/2 знаків/);
    expect(() => parseScaled("abc", 2)).toThrow();
    expect(() => parseScaled("1e5", 2)).toThrow();
  });

  it("0.1 + 0.2 рахується точно (на відміну від float)", () => {
    expect(toDecimalString(parseScaled("0.1", 2) + parseScaled("0.2", 2), 2)).toBe("0.30");
  });

  it("округлення «половина від нуля» як round(numeric, 2) у PostgreSQL", () => {
    expect(divRoundHalfAwayFromZero(125n, 10n)).toBe(13n);
    expect(divRoundHalfAwayFromZero(124n, 10n)).toBe(12n);
    expect(divRoundHalfAwayFromZero(-125n, 10n)).toBe(-13n);
    expect(divRoundHalfAwayFromZero(-124n, 10n)).toBe(-12n);
  });

  it("10. споживання K = P_current − P_prev", () => {
    expect(consumption(parseScaled("12345.67", 2), parseScaled("12478.12", 2))).toBe(13245n);
  });

  it("11. сума за тарифом E = K × T з округленням до копійок", () => {
    // 132.45 × 4.32 = 572.184 → 572.18
    expect(electricityAmount(13245n, 43200n)).toBe(57218n);
    // 100.5 × 2.6401 = 265.33005 → 265.33
    expect(electricityAmount(10050n, 26401n)).toBe(26533n);
    // 0.25 × 2.5 = 0.625 → 0.63 (половина від нуля)
    expect(electricityAmount(25n, 25000n)).toBe(63n);
    expect(electricityAmount(0n, 43200n)).toBe(0n);
  });

  it("12. Total = Electricity + Deposit + HallLighting + Other", () => {
    expect(totalAmount({ electricity: 57218n, deposit: 5000n, hallLighting: 1550n, other: 0n })).toBe(63768n);
  });

  it("повний розрахунок нарахування і помилки вводу", () => {
    const r = calculateCharge({ previous: "12345.67", current: "12478,12", tariff: "4.32", deposit: "50", hallLighting: "15.50" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.consumption).toBe(13245n);
      expect(r.value.electricity).toBe(57218n);
      expect(r.value.total).toBe(63768n);
    }
    const lower = calculateCharge({ previous: "100", current: "99", tariff: "4.32" });
    expect(lower).toMatchObject({ ok: false });
    if (!lower.ok) expect(lower.error).toMatch(/менший за попередній/);
    expect(calculateCharge({ previous: "1", current: "2", tariff: "0" })).toMatchObject({ ok: false, error: "Тариф не визначено" });
    expect(calculateCharge({ previous: "-1", current: "2", tariff: "1" })).toMatchObject({ ok: false });
    expect(calculateCharge({ previous: "1", current: "2", tariff: "1", deposit: "-5" })).toMatchObject({ ok: false });
  });

  it("22. розбіжність: загальний мінус сума квартир", () => {
    const d = discrepancy(30000n, [10000n, 15050n, 2000n]);
    expect(d).toEqual({ apartmentTotal: 27050n, discrepancy: 2950n, absolute: 2950n });
    const neg = discrepancy(15000n, [10000n, 10000n]);
    expect(neg.discrepancy).toBe(-5000n);
    expect(neg.absolute).toBe(5000n);
  });

  it("баланс депозиту — сума записів журналу зі знаком", () => {
    expect(
      depositBalance([
        { type: "contribution", amount: 35000n },
        { type: "discrepancy_adjustment", amount: -12744n },
        { type: "correction", amount: 500n },
        { type: "refund", amount: -2256n },
      ]),
    ).toBe(20500n);
  });

  it("форматування для інтерфейсу та CSV", () => {
    expect(formatMoney("1234.5")).toBe("1 234,50 грн");
    expect(formatMoney(-12744n)).toBe("−127,44 грн");
    expect(formatMoney(null)).toBe("—");
    expect(formatKwh("100.00")).toBe("100 кВт·год");
    expect(formatKwh(13245n)).toBe("132,45 кВт·год");
    expect(fromDb(572.18, 2)).toBe(57218n);
    expect(fromDb("0.30000000000000004", 2)).toBe(30n);
    expect(plainDecimal("1234.5", 2)).toBe("1234,50");
  });
});

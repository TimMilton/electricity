/* eslint-disable @typescript-eslint/no-explicit-any -- довільна структура JSON-відповіді в тестах */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
});
afterAll(async () => db?.destroy());

async function reading(apt: string, period: string) {
  return (await db.sql(`select previous_reading::text p, current_reading::text c, consumption_kwh::text k
                          from meter_readings where apartment_id = $1 and billing_period_id = $2`, [apt, period])).rows[0];
}

describe("Перше подання показника мешканцем", () => {
  it("вказує показник на початок обліку і поточний; далі попередній підставляється сам", async () => {
    const apt = await db.createApartment(admin, "11", "Перша"); // без початкового показника
    const uid = await db.registerResident(admin, apt, "Перша");
    const sep = await db.openPeriod(admin, 2025, 9);

    // без показника на початок обліку подати не можна
    await expectDbError(db.submitReading(uid, apt, sep, "1100"), /Не знайдено попереднього показника/);

    const first = await db.submitReading(uid, apt, sep, "1100", { previous: "1000" });
    expect(first.warnings.join(" ")).toMatch(/перше подання/);
    expect(await reading(apt, sep)).toEqual({ p: "1000.00", c: "1100.00", k: "100.00" });

    // поки вікно відкрите — можна виправити і початковий, і поточний показник
    const fixed = await db.submitReading(uid, apt, sep, "1105", { previous: "1010" });
    expect(fixed.warnings.join(" ")).toMatch(/на початок обліку змінено/);
    expect(await reading(apt, sep)).toEqual({ p: "1010.00", c: "1105.00", k: "95.00" });
    expect((await db.paymentFor(apt, sep))!.electricity_amount).toBe("410.40"); // 95 × 4,32

    // наступний місяць: попередній = поточний за вересень, вводити не потрібно
    const oct = await db.openPeriod(admin, 2025, 10);
    const prev = (await db.as<{ previous_reading: string }>(uid,
      `select previous_reading::text from public.get_previous_reading($1, $2)`, [apt, oct])).rows[0];
    expect(prev?.previous_reading).toBe("1105.00");
    await db.submitReading(uid, apt, oct, "1250");
    expect(await reading(apt, oct)).toEqual({ p: "1105.00", c: "1250.00", k: "145.00" });

    // змінити попередній уже не можна — лише адміністратор
    await expectDbError(db.submitReading(uid, apt, oct, "1250", { previous: "1000" }), /зверніться до адміністратора/);
    // той самий попередній показник не заважає збереженню
    await db.submitReading(uid, apt, oct, "1260", { previous: "1105" });
    expect(await reading(apt, oct)).toEqual({ p: "1105.00", c: "1260.00", k: "155.00" });
    await db.submitReading(admin, apt, oct, "1260", { previous: "1100", reason: "Заміна лічильника" });
    expect(await reading(apt, oct)).toEqual({ p: "1100.00", c: "1260.00", k: "160.00" });
  });

  it("якщо адміністратор задав початковий показник — мешканець його не змінює", async () => {
    const apt = await db.createApartment(admin, "12", "Друга", "500");
    const uid = await db.registerResident(admin, apt, "Друга");
    const p = (await db.sql(`select id from billing_periods where year = 2025 and month = 10`)).rows[0]!.id as string;
    await db.submitReading(uid, apt, p, "600");
    expect(await reading(apt, p)).toEqual({ p: "500.00", c: "600.00", k: "100.00" });
    await expectDbError(db.submitReading(uid, apt, p, "600", { previous: "450" }), /зверніться до адміністратора/);
  });
});

describe("Показники загального лічильника за минулі місяці", () => {
  async function upsert(periodId: string, current: string, opts: { previous?: string; reason?: string; next?: boolean } = {}) {
    const r = await db.as<{ r: Record<string, any> }>(
      admin,
      `select public.admin_upsert_common_reading($1, $2::numeric, $3::numeric, null, $4, false, $5) as r`,
      [periodId, current, opts.previous ?? null, opts.reason ?? null, opts.next ?? false],
    );
    return r.rows[0]!.r;
  }
  const common = async (p: string) =>
    (await db.sql(`select previous_reading::text p, current_reading::text c from common_meter_readings where billing_period_id = $1`, [p])).rows[0];
  const rec = async (p: string) =>
    (await db.sql(`select common_consumption_kwh::text k, status from reconciliation_records where billing_period_id = $1`, [p])).rows[0];

  it("виправлення минулого місяця може узгодити початок наступного", async () => {
    const jun = await db.openPeriod(admin, 2025, 6);
    const jul = await db.openPeriod(admin, 2025, 7);
    await upsert(jun, "2000", { previous: "1000" });
    await upsert(jul, "3000"); // починається з 2000

    // без узгодження — лише попередження, липень не змінюється
    const a = await upsert(jun, "2100", { reason: "Уточнення" });
    expect(a.warnings.join(" ")).toMatch(/липень 2025 починається з 2000/i);
    expect(await common(jul)).toEqual({ p: "2000.00", c: "3000.00" });

    // з узгодженням — липень починається з нового значення, розбіжність перераховано
    const b = await upsert(jun, "2150", { reason: "Уточнення 2", next: true });
    expect(b.warnings.join(" ")).toMatch(/змінено з 2000.* на 2150/);
    expect(await common(jul)).toEqual({ p: "2150.00", c: "3000.00" });
    expect(await rec(jul)).toEqual({ k: "850.00", status: "calculated" });
    const log = await db.sql(`select reason from audit_logs where action_type = 'common_reading.update'
                                and new_values->>'previous_reading' = '2150.00'`);
    expect(log.rows[0]!.reason).toMatch(/узгоджено.*червень 2025: Уточнення 2/);

    // наступний місяць не може початися з більшого значення, ніж закінчився
    await expectDbError(upsert(jun, "3100", { reason: "Помилка", next: true }), /менший за новий/);
    expect(await common(jun)).toEqual({ p: "1000.00", c: "2150.00" }); // нічого не змінилося

    // невідповідність з попереднім місяцем — попередження
    const c = await upsert(jul, "3000", { previous: "2160", reason: "Перевірка" });
    expect(c.warnings.join(" ")).toMatch(/червень 2025 закінчується на 2150/i);
  });

  it("показник можна внести заднім числом у місяць без показника", async () => {
    const may = await db.openPeriod(admin, 2025, 5);
    const res = await upsert(may, "1000", { previous: "400", next: true });
    expect(await common(may)).toEqual({ p: "400.00", c: "1000.00" });
    expect(res.warnings).toEqual([]); // червень уже починається з 1000
  });
});

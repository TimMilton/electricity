/* eslint-disable @typescript-eslint/no-explicit-any -- довільна структура JSON-відповіді в тестах */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
});
afterAll(async () => db?.destroy());

const tariffFor = async (period: string) =>
  (await db.as<{ t: string | null }>(admin, `select public.get_applicable_tariff($1)::text t`, [period])).rows[0]!.t;
const update = async (id: string, rate: string, from: string, reason: string | null = "Помилка в даті") =>
  (await db.as<{ r: Record<string, any> }>(admin, `select public.admin_update_tariff($1, $2::numeric, $3::date, $4) r`, [id, rate, from, reason]))
    .rows[0]!.r;
const tariffs = async () =>
  (await db.sql(`select rate_per_kwh::text r, valid_from::text f, valid_until::text u from tariffs order by valid_from`)).rows;

describe("Виправлення тарифу", () => {
  it("тариф із пізнішою датою не діє для місяця; після виправлення дати — діє", async () => {
    const apt = await db.createApartment(admin, "1", "Тест", "1000");
    const uid = await db.registerResident(admin, apt, "Тест");
    const oct = await db.openPeriod(admin, 2026, 10);
    await db.setTariff(admin, "4.32", "2026-10-30"); // за замовчуванням форма підставляла «сьогодні»
    expect(await tariffFor(oct)).toBeNull();
    await expectDbError(db.submitReading(uid, apt, oct, "1100"), /Тариф для цього періоду не визначено/);
    // раніший тариф додати не можна, а минулий — видалити
    await expectDbError(db.setTariff(admin, "4.32", "2026-10-01"), /пізніше за останній/);

    const id = (await db.sql(`select id from tariffs`)).rows[0]!.id as string;
    await expectDbError(update(id, "4.32", "2026-10-01", null), /причину/);
    const res = await update(id, "4.32", "2026-10-01");
    expect(res.warnings).toEqual([]);
    expect(await tariffFor(oct)).toBe("4.3200");
    const r = await db.submitReading(uid, apt, oct, "1100");
    expect(r.reading.electricity_amount).toBe(432);

    const log = await db.sql(`select reason, previous_values->>'valid_from' a, new_values->>'valid_from' b
                                from audit_logs where action_type = 'tariff.update'`);
    expect(log.rows[0]).toEqual({ reason: "Помилка в даті", a: "2026-10-30", b: "2026-10-01" });
  });

  it("дата лишається між сусідніми тарифами, кінець попереднього зсувається; нарахування не перераховуються", async () => {
    await db.setTariff(admin, "5", "2027-01-01");
    const [, second] = (await db.sql(`select id from tariffs order by valid_from`)).rows.map((r) => r.id as string);
    await expectDbError(update(second!, "5", "2026-09-01"), /пізніше за початок попереднього тарифу \(01\.10\.2026\)/);
    const first = (await db.sql(`select id from tariffs order by valid_from limit 1`)).rows[0]!.id as string;
    await expectDbError(update(first, "4.32", "2027-02-01"), /раніше за початок наступного тарифу \(01\.01\.2027\)/);

    // другий тариф починається раніше — з листопада; жовтень не зачеплено
    await update(second!, "5", "2026-11-01");
    expect(await tariffs()).toEqual([
      { r: "4.3200", f: "2026-10-01", u: "2026-10-31" },
      { r: "5.0000", f: "2026-11-01", u: null },
    ]);

    // зміна ставки для місяця, де вже є показник, — лише попередження
    const res = await update(first, "4.5", "2026-10-01", "Уточнена ставка");
    expect(res.warnings.join(" ")).toMatch(/1 збережен.*не перераховано/);
    const stored = (await db.sql(`select tariff_rate::text t, electricity_amount::text e from meter_readings`)).rows[0];
    expect(stored).toEqual({ t: "4.3200", e: "432.00" });
  });

  it("мешканцю недоступно", async () => {
    const apt = await db.createApartment(admin, "2", "Інший", "0");
    const uid = await db.registerResident(admin, apt, "Інший");
    const id = (await db.sql(`select id from tariffs limit 1`)).rows[0]!.id as string;
    await expectDbError(db.as(uid, `select public.admin_update_tariff($1, 1, '2026-10-01', 'тест')`, [id]), /лише адміністратору/);
  });
});

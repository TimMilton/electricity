/* eslint-disable @typescript-eslint/no-explicit-any -- довільна структура JSON-відповіді в тестах */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;
let a1: string, a2: string, u1: string, u2: string, period: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
  a1 = await db.createApartment(admin, "1", "Перша", "1000");
  a2 = await db.createApartment(admin, "2", "Друга", "2000");
  u1 = await db.registerResident(admin, a1, "Перша");
  u2 = await db.registerResident(admin, a2, "Друга");
  period = await db.openPeriod(admin, 2026, 10);
  await db.submitReading(u1, a1, period, "1100", { deposit: "50", hall: "15.50" }); // 432 + 65.50
  await db.submitReading(u2, a2, period, "2050", { deposit: "100", hall: "20" }); // 216 + 120
});
afterAll(async () => db?.destroy());

const summary = async (uid: string, p: string | null = period) =>
  (await db.as<{ s: Record<string, any> }>(uid, `select public.get_house_summary($1) s`, [p])).rows[0]!.s;

describe("Видалення квитанцій адміністратором", () => {
  it("лише адміністратор, з причиною; платіж не змінюється; запис у журналі; квитанцію не видалити напряму", async () => {
    const pay = (await db.paymentFor(a1, period))!;
    await db.as(u1, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(a1, pay.id!, "перша.pdf")]);
    await db.as(u1, `select public.add_payment_receipts($1, $2::jsonb)`, [pay.id, db.receiptJson(a1, pay.id!, "друга.pdf")]);
    const receipts = (await db.sql(`select id, storage_path, original_filename from receipts where payment_id = $1 order by original_filename`, [pay.id])).rows;
    expect(receipts).toHaveLength(2);

    // напряму (навіть власник бази) — заборонено
    await expectDbError(db.sql(`delete from receipts where id = $1`, [receipts[0]!.id]), /адміністративну дію/);
    // мешканцю — заборонено
    await expectDbError(db.as(u1, `select public.admin_delete_receipt($1, 'помилка')`, [receipts[0]!.id]), /лише адміністратору/);
    // без причини — ні
    await expectDbError(db.as(admin, `select public.admin_delete_receipt($1, '')`, [receipts[0]!.id]), /причину/);

    const before = (await db.sql(`select status, total_amount::text t from payments where id = $1`, [pay.id])).rows[0];
    const r1 = (await db.as<{ r: any }>(admin, `select public.admin_delete_receipt($1, 'Помилковий файл') r`, [receipts[0]!.id])).rows[0]!.r;
    expect(r1.storage_path).toBe(receipts[0]!.storage_path); // сервер прибере файл зі сховища
    expect(r1.warnings).toEqual([]);
    expect((await db.sql(`select status, total_amount::text t from payments where id = $1`, [pay.id])).rows[0]).toEqual(before);

    const row = (await db.as<{ receipt_count: number }>(u2, `select receipt_count from public.get_period_table($1) where apartment_id = $2`, [period, a1])).rows[0];
    expect(row!.receipt_count).toBe(1);

    // остання квитанція платежу на перевірці — попередження
    const r2 = (await db.as<{ r: any }>(admin, `select public.admin_delete_receipt($1, 'Дублікат') r`, [receipts[1]!.id])).rows[0]!.r;
    expect(r2.warnings.join(" ")).toMatch(/не залишилося квитанцій/);
    await expectDbError(db.as(admin, `select public.admin_delete_receipt($1, 'ще раз')`, [receipts[1]!.id]), /вже видалено/);

    const log = await db.sql(`select reason, previous_values->>'original_filename' f from audit_logs
                               where action_type = 'receipt.delete' order by created_at`);
    expect(log.rows).toEqual([{ reason: "Помилковий файл", f: "друга.pdf" }, { reason: "Дублікат", f: "перша.pdf" }]);

    // платіж без квитанцій можна підтвердити з приміткою, як і раніше
    await db.as(admin, `select public.approve_payment($1, 'Переказ перевірено в банку')`, [pay.id]);
    expect((await db.paymentFor(a1, period))!.status).toBe("paid");
  });
});

describe("Зведення «Будинок»: збори поза електроенергією і конверт", () => {
  it("суми депозиту й освітлення, усього нараховано, підтверджено; посилання на конверт", async () => {
    await db.sql(`update app_settings set envelope_url = 'https://send.monobank.ua/jar/test'`);
    // загального лічильника ще немає — зведення за поточним місяцем
    const s0 = await summary(u2, null);
    expect(s0).toMatchObject({
      has_common: false,
      envelope_url: "https://send.monobank.ua/jar/test",
      charged_deposit: 150,
      charged_hall_lighting: 35.5,
      charged_extras: 185.5,
      charged_total: 833.5, // 432 + 216 + 185.50
      paid_total: 497.5, // квартира 1 підтверджена в попередньому тесті
      paid_extras: 65.5,
    });
    expect(s0.period.id).toBe(period);

    await db.as(admin, `select public.admin_upsert_common_reading($1, 50200, 50000, null, null)`, [period]);
    const s1 = await summary(u1);
    expect(s1).toMatchObject({ has_common: true, common_amount: 864, apartments_amount: 648, charged_extras: 185.5, charged_total: 833.5 });
  });

  it("повторне застосування міграції не змінює наявних даних", async () => {
    const snapshot = async () => ({
      readings: (await db.sql(`select * from meter_readings order by id`)).rows,
      charges: (await db.sql(`select * from additional_charges order by id`)).rows,
      payments: (await db.sql(`select * from payments order by id`)).rows,
      receipts: (await db.sql(`select * from receipts order by id`)).rows,
      ledger: (await db.sql(`select * from deposit_ledger order by id`)).rows,
      apartments: (await db.sql(`select * from apartments order by id`)).rows,
    });
    const before = await snapshot();
    for (const f of ["20261101000002_entrance.sql", "20261101000004_receipts_house_totals.sql"]) {
      await db.sql(readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8"));
    }
    expect(await snapshot()).toEqual(before);
  });
});

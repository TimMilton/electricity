/* eslint-disable @typescript-eslint/no-explicit-any -- довільна структура JSON-відповіді в тестах */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";

let db: TestDb;
let admin: string;
let u1: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
});
afterAll(async () => db?.destroy());

const summary = async (p: string) =>
  (await db.as<{ s: Record<string, any> }>(u1, `select public.get_house_summary($1) s`, [p])).rows[0]!.s;

describe("Різницю спершу покриває освітлення під'їзду, потім депозит", () => {
  it("борг 432 грн, освітлення 120 грн → з депозиту 312 грн", async () => {
    const a1 = await db.createApartment(admin, "1", "Перша", "1000");
    const a2 = await db.createApartment(admin, "2", "Друга", "2000");
    u1 = await db.registerResident(admin, a1, "Перша");
    const u2 = await db.registerResident(admin, a2, "Друга");
    const p = await db.openPeriod(admin, 2026, 10);
    await db.submitReading(u1, a1, p, "1100", { deposit: "500", hall: "70" }); // 100 кВт·год
    await db.submitReading(u2, a2, p, "2100", { hall: "50" }); // 100 кВт·год
    // депозит 500 зараховується після підтвердження оплати
    const pay = (await db.paymentFor(a1, p))!;
    await db.as(u1, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(a1, pay.id!)]);
    await db.as(admin, `select public.approve_payment($1, null)`, [pay.id]);

    await db.as(admin, `select public.admin_upsert_common_reading($1, 50300, 50000, null, null)`, [p]); // 300 → різниця 100 кВт·год
    const s = await summary(p);
    expect(s).toMatchObject({
      discrepancy_amount: 432,
      charged_hall_lighting: 120,
      hall_lighting_cover: 120,
      debt_after_hall_lighting: 312,
      deposit_balance: 500,
      deposit_after: 188, // 500 − 312
    });

    // адміністратор покрив 200 з депозиту → лишається 112
    const rec = (await db.sql(`select id from reconciliation_records where billing_period_id = $1`, [p])).rows[0]!.id;
    await db.as(admin, `select public.admin_review_reconciliation($1, null)`, [rec]);
    await db.as(admin, `select public.admin_apply_deposit_adjustment($1, 200, 'Частково')`, [rec]);
    const s2 = await summary(p);
    expect(s2).toMatchObject({ deposit_used: 200, deposit_balance: 300, deposit_after: 188 }); // 300 − 112
  });

  it("освітлення більше за різницю — боргу немає, надлишок", async () => {
    const a3 = await db.createApartment(admin, "3", "Третя", "3000");
    const u3 = await db.registerResident(admin, a3, "Третя");
    const p = await db.openPeriod(admin, 2026, 11);
    await db.submitReading(u3, a3, p, "3100", { hall: "100" }); // 100 кВт·год
    const a1 = (await db.sql(`select id from apartments where apartment_number = '1'`)).rows[0]!.id;
    await db.submitReading(u1, a1, p, "1150"); // 50 кВт·год
    await db.as(admin, `select public.admin_upsert_common_reading($1, 50460, 50300, null, null)`, [p]); // 160 → різниця 10 кВт·год = 43,20
    const s = await summary(p);
    expect(s).toMatchObject({ discrepancy_amount: 43.2, hall_lighting_cover: 43.2, debt_after_hall_lighting: -56.8, deposit_after: null });
  });
});

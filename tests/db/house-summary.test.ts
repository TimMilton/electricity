/* eslint-disable @typescript-eslint/no-explicit-any -- довільна структура JSON-відповіді в тестах */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;
let period: string;
const res: { apt: string; uid: string }[] = [];

async function summary(uid: string, periodId: string | null = null) {
  const r = await db.as<{ s: Record<string, any> }>(uid, `select public.get_house_summary($1::uuid) as s`, [periodId]);
  return r.rows[0]!.s;
}

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
  period = await db.openPeriod(admin, 2026, 9);
  for (const [n, s] of [["1", "Перша"], ["2", "Друга"], ["3", "Третя"]] as const) {
    const apt = await db.createApartment(admin, n, s, "1000");
    res.push({ apt, uid: await db.registerResident(admin, apt, s) });
  }
});
afterAll(async () => db?.destroy());

describe("Зведення по будинку в кабінеті мешканця", () => {
  it("без показника загального лічильника — порожнє зведення", async () => {
    const s = await summary(res[0]!.uid);
    expect(s).toMatchObject({ period: null, has_common: false, deposit_public: true });
    const forPeriod = await summary(res[0]!.uid, period);
    expect(forPeriod).toMatchObject({ has_common: false, common_kwh: null, discrepancy_amount: null });
    expect(forPeriod.period.label).toBe("Вересень 2026");
  });

  it("показує загальний лічильник, різницю в кВт·год і борг у гривнях", async () => {
    await db.submitReading(res[0]!.uid, res[0]!.apt, period, "1100", { deposit: "200" }); // 100 кВт·год, 432,00
    await db.submitReading(res[1]!.uid, res[1]!.apt, period, "1150.5", { deposit: "100" }); // 150,5 → 650,16
    await db.as(admin, `select public.admin_upsert_common_reading($1, 50300, 50000, null, null)`, [period]); // 300

    const s = await summary(res[0]!.uid);
    expect(s).toMatchObject({
      has_common: true,
      common_previous: 50000,
      common_current: 50300,
      common_kwh: 300,
      apartments_kwh: 250.5,
      apartments_with_readings: 2,
      active_apartments: 3,
      apartments_missing: 1,
      is_preliminary: true,
      discrepancy_kwh: 49.5,
      tariff_rate: 4.32,
      common_amount: 1296, // 300 × 4,32
      apartments_amount: 1082.16, // 432,00 + 650,16
      discrepancy_amount: 213.84, // 1296 − 1082,16
      reconciliation_status: "calculated",
      deposit_public: true,
      deposit_balance: 0,
      deposit_already_applied: false,
      deposit_after: -213.84,
    });
    expect(s.period.label).toBe("Вересень 2026");
  });

  it("враховує підтверджені внески в депозиті та не віднімає різницю двічі", async () => {
    for (const r of res.slice(0, 2)) {
      const pay = (await db.paymentFor(r.apt, period))!;
      await db.as(r.uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(r.apt, pay.id!)]);
      await db.as(admin, `select public.approve_payment($1, null)`, [pay.id]);
    }
    let s = await summary(res[2]!.uid);
    expect(s).toMatchObject({ deposit_balance: 300, deposit_after: 86.16, paid_electricity: 1082.16 });

    // адміністратор покрив різницю з депозиту — баланс уже зменшено, «після покриття» не рахується вдруге
    const rec = (await db.sql<{ id: string }>(`select id from reconciliation_records where billing_period_id = $1`, [period])).rows[0]!;
    await db.as(admin, `select public.admin_review_reconciliation($1, 'Неповні дані: кв. 3 не подала')`, [rec.id]);
    await db.as(admin, `select public.admin_apply_deposit_adjustment($1, 213.84, 'Покриття розбіжності')`, [rec.id]);
    s = await summary(res[2]!.uid);
    expect(s).toMatchObject({ deposit_balance: 86.16, deposit_already_applied: true, deposit_after: null, reconciliation_status: "adjustment_applied" });
    // внутрішнє пояснення адміністратора мешканцю не віддається
    expect(JSON.stringify(s)).not.toContain("не подала");
  });

  it("приховує депозит, якщо адміністратор вимкнув його показ", async () => {
    await db.as(admin, `select public.admin_update_settings('{"show_deposit_balance_to_residents": false}'::jsonb, null)`);
    const s = await summary(res[0]!.uid);
    expect(s).toMatchObject({ deposit_public: false, deposit_balance: null, deposit_after: null, has_common: true, common_kwh: 300 });
    // адміністратор бачить завжди
    expect((await summary(admin)).deposit_balance).toBe(86.16);
    await db.as(admin, `select public.admin_update_settings('{"show_deposit_balance_to_residents": true}'::jsonb, null)`);
  });

  it("від'ємна різниця: борг не виникає, депозит не зменшується", async () => {
    const p2 = await db.openPeriod(admin, 2026, 10);
    await db.submitReading(res[0]!.uid, res[0]!.apt, p2, "1300"); // 200
    await db.as(admin, `select public.admin_upsert_common_reading($1, 50450, null, null, null)`, [p2]); // 150
    const s = await summary(res[0]!.uid, p2);
    expect(s).toMatchObject({ discrepancy_kwh: -50, discrepancy_amount: -216, deposit_after: null });
    // без параметра — останній місяць із показником загального лічильника
    expect((await summary(res[0]!.uid)).period.label).toBe("Жовтень 2026");
  });

  it("доступ: прямі таблиці загального лічильника залишаються закритими; анонім не має доступу", async () => {
    expect((await db.as(res[0]!.uid, `select * from common_meter_readings`)).rowCount).toBe(0);
    expect((await db.as(res[0]!.uid, `select * from reconciliation_records`)).rowCount).toBe(0);
    await expectDbError(db.asAnon(`select public.get_house_summary(null)`), /permission denied/);
  });
});

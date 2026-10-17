/* eslint-disable @typescript-eslint/no-explicit-any -- довільна структура JSON-звіту в тестах */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;
let period: string;
const apts: { apt: string; uid: string }[] = [];

async function payAndApprove(i: number, deposit: string) {
  const { apt, uid } = apts[i]!;
  const pay = (await db.paymentFor(apt, period))!;
  await db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!)]);
  await db.as(admin, `select public.approve_payment($1, null)`, [pay.id]);
  void deposit;
}

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
  period = await db.openPeriod(admin, 2026, 9);
  for (const [n, s] of [["1", "Андрієнко"], ["2", "Борисенко"], ["3", "Василенко"]] as const) {
    const apt = await db.createApartment(admin, n, s, "1000");
    const uid = await db.registerResident(admin, apt, s);
    apts.push({ apt, uid });
  }
});
afterAll(async () => db?.destroy());

describe("Загальний лічильник, розбіжності та депозит", () => {
  it("21–23. розрахунок загального споживання, розбіжності та статус неповних даних", async () => {
    await db.submitReading(apts[0]!.uid, apts[0]!.apt, period, "1100", { deposit: "200" }); // 100
    await db.submitReading(apts[1]!.uid, apts[1]!.apt, period, "1150.5", { deposit: "150" }); // 150.5

    // мешканець не може вносити показники загального лічильника
    await expectDbError(db.as(apts[0]!.uid, `select public.admin_upsert_common_reading($1, 500, 0, null, null)`, [period]), /лише адміністратору/);
    await expectDbError(db.as(apts[0]!.uid, `select * from common_meter_readings`).then((r) => {
      if (r.rowCount === 0) throw new Error("permission-hidden");
    }), /permission-hidden/);

    const r = await db.as<{ r: { reconciliation: Record<string, number | boolean | string> } }>(
      admin, `select public.admin_upsert_common_reading($1, 50300, 50000, null, null) as r`, [period]);
    const rec = r.rows[0]!.r.reconciliation;
    expect(rec).toMatchObject({
      common_consumption_kwh: 300,
      apartment_consumption_kwh: 250.5,
      discrepancy_kwh: 49.5,
      discrepancy_amount: 213.84, // 49.5 × 4.32
      readings_count: 2,
      active_apartments_count: 3,
      is_preliminary: true,
      status: "calculated",
    });

    // третя квартира подає — розрахунок стає остаточним
    await db.submitReading(apts[2]!.uid, apts[2]!.apt, period, "1020"); // 20
    const rec2 = (await db.as<{ is_preliminary: boolean; discrepancy_kwh: string }>(admin,
      `select is_preliminary, discrepancy_kwh::text from public.calculate_reconciliation($1)`, [period])).rows[0]!;
    expect(rec2).toEqual({ is_preliminary: false, discrepancy_kwh: "29.50" });

    // поточний показник загального лічильника не може бути меншим за попередній
    await expectDbError(db.as(admin, `select public.admin_upsert_common_reading($1, 100, 200, null, 'тест')`, [period]), /менший за попередній/);
    // виправлення потребує причини
    await expectDbError(db.as(admin, `select public.admin_upsert_common_reading($1, 50310, null, null, null)`, [period]), /вкажіть причину/);
  });

  it("20, 24. депозит поповнюється лише після підтвердження; розбіжність не списує депозит автоматично", async () => {
    expect(await db.depositBalance()).toBe("0.00");
    await payAndApprove(0, "200");
    await payAndApprove(1, "150");
    expect(await db.depositBalance()).toBe("350.00");
    // розрахунок і перевірка розбіжності не змінюють баланс
    const rec = (await db.sql<{ id: string }>(`select id from reconciliation_records where billing_period_id = $1`, [period])).rows[0]!;
    await db.as(admin, `select public.admin_review_reconciliation($1, null)`, [rec.id]);
    expect(await db.depositBalance()).toBe("350.00");
    const adj = await db.sql(`select count(*)::int c from deposit_ledger where transaction_type = 'discrepancy_adjustment'`);
    expect(adj.rows[0]!.c).toBe(0);
  });

  it("25. ручне списання депозиту адміністратором: перевірки, журнал, баланс", async () => {
    const rec = (await db.sql<{ id: string }>(`select id from reconciliation_records where billing_period_id = $1`, [period])).rows[0]!;
    await expectDbError(db.as(apts[0]!.uid, `select public.admin_apply_deposit_adjustment($1, 10, 'x')`, [rec.id]), /лише адміністратору/);
    await expectDbError(db.as(admin, `select public.admin_apply_deposit_adjustment($1, 10, '')`, [rec.id]), /підставу/);
    await expectDbError(db.as(admin, `select public.admin_apply_deposit_adjustment($1, 1000, 'Оплата обленерго')`, [rec.id]), /Недостатньо коштів.*350,00/);
    await expectDbError(db.as(admin, `select public.admin_apply_deposit_adjustment($1, 0.001, 'x')`, [rec.id]), /копійок/);

    const led = (await db.as<{ id: string; amount: string; transaction_type: string }>(admin,
      `select id, amount::text, transaction_type from public.admin_apply_deposit_adjustment($1, 127.44, 'Покриття розбіжності за вересень')`, [rec.id])).rows[0]!;
    expect(led).toMatchObject({ amount: "-127.44", transaction_type: "discrepancy_adjustment" });
    expect(await db.depositBalance()).toBe("222.56");

    const status = await db.sql(`select status from reconciliation_records where id = $1`, [rec.id]);
    expect(status.rows[0]!.status).toBe("adjustment_applied");
    const audit = await db.sql(`select actor_user_id, reason, new_values->>'balance' bal from audit_logs where entity_id = $1`, [led.id]);
    expect(audit.rows[0]).toMatchObject({ actor_user_id: admin, reason: "Покриття розбіжності за вересень", bal: "222.56" });

    // журнал незмінний навіть для суперкористувача
    await expectDbError(db.sql(`update deposit_ledger set amount = -1 where id = $1`, [led.id]), /не можна змінювати/);
    await expectDbError(db.sql(`delete from deposit_ledger where id = $1`, [led.id]), /не можна змінювати/);
    // після використання розбіжність не перераховується
    await expectDbError(db.as(admin, `select public.calculate_reconciliation($1)`, [period]), /уже використана/);
  });

  it("Від'ємна розбіжність не дозволяє списання; потрібне пояснення при перевірці", async () => {
    const p2 = await db.openPeriod(admin, 2026, 10);
    await db.submitReading(apts[0]!.uid, apts[0]!.apt, p2, "1200"); // 100
    await db.submitReading(apts[1]!.uid, apts[1]!.apt, p2, "1250.5"); // 100
    await db.submitReading(apts[2]!.uid, apts[2]!.apt, p2, "1120"); // 100
    const r = await db.as<{ r: { reconciliation: { id: string; discrepancy_kwh: number } } }>(
      admin, `select public.admin_upsert_common_reading($1, 50450, null, null, null) as r`, [p2]); // попередній = 50300 → 150
    const rec = r.rows[0]!.r.reconciliation;
    expect(rec.discrepancy_kwh).toBe(-150);
    await expectDbError(db.as(admin, `select public.admin_review_reconciliation($1, null)`, [rec.id]), /пояснення/);
    await db.as(admin, `select public.admin_review_reconciliation($1, 'Перевірено показники квартир')`, [rec.id]);
    await expectDbError(db.as(admin, `select public.admin_apply_deposit_adjustment($1, 10, 'x')`, [rec.id]), /не є додатною/);
    expect(await db.depositBalance()).toBe("222.56");
  });

  it("Коригування та повернення: напрямок суми, достатність балансу", async () => {
    await expectDbError(db.as(admin, `select public.admin_create_deposit_operation('contribution', 10, 'x', $1, null)`, [period]), /відповідні процеси/);
    await expectDbError(db.as(admin, `select public.admin_create_deposit_operation('refund', 1000, 'Повернення', $1, null)`, [period]), /Недостатньо/);
    await db.as(admin, `select public.admin_create_deposit_operation('refund', 22.56, 'Повернення кв. 1', $1, $2)`, [period, apts[0]!.apt]);
    await db.as(admin, `select public.admin_create_deposit_operation('correction', 10, 'Виправлення помилки обліку', $1, null)`, [period]);
    await db.as(admin, `select public.admin_create_deposit_operation('correction', -5, 'Виправлення', $1, null)`, [period]);
    // 222.56 − 22.56 + 10 − 5
    expect(await db.depositBalance()).toBe("205.00");
  });

  it("9.5. мешканець бачить свої внески і загальний баланс лише якщо дозволено", async () => {
    const s1 = (await db.as<{ s: Record<string, unknown> }>(apts[0]!.uid, `select public.get_deposit_summary() as s`)).rows[0]!.s;
    expect(s1.is_public).toBe(true);
    expect(s1.balance).toBe(205);
    expect((s1.my_contributions as { declared_amount: number; confirmed: boolean }[])[0]).toMatchObject({ declared_amount: 200, confirmed: true });
    const usage = s1.usage as { description: string }[];
    expect(usage.length).toBeGreaterThan(0);
    expect(JSON.stringify(usage)).not.toContain(apts[0]!.apt);

    // мешканець не бачить чужі внески в журналі напряму
    const rows = await db.as(apts[0]!.uid, `select apartment_id, transaction_type from deposit_ledger`);
    expect(rows.rows.every((r) => r.apartment_id === apts[0]!.apt && r.transaction_type === "contribution")).toBe(true);
    // і не може писати в журнал
    await expectDbError(db.as(apts[0]!.uid,
      `insert into deposit_ledger (billing_period_id, transaction_type, amount, description, created_by) values ($1, 'correction', 1000, 'x', $2)`,
      [period, apts[0]!.uid]), /permission denied/);

    await db.as(admin, `select public.admin_update_settings('{"show_deposit_balance_to_residents": false}'::jsonb, null)`);
    const s2 = (await db.as<{ s: Record<string, unknown> }>(apts[0]!.uid, `select public.get_deposit_summary() as s`)).rows[0]!.s;
    expect(s2).toMatchObject({ is_public: false, balance: null, usage: null });
    expect((s2.my_contributions as unknown[]).length).toBe(1);
  });

  it("17. звіт за будинком розділяє нарахування, підтверджені платежі та рух депозиту", async () => {
    const rep = (await db.as<{ r: Record<string, any> }>(admin, `select public.get_house_report($1) as r`, [period])).rows[0]!.r;
    expect(rep.common_consumption_kwh).toBe(300);
    expect(rep.apartments_without_readings).toBe(0);
    expect(rep.is_preliminary).toBe(false);
    expect(rep.payments.paid_count).toBe(2);
    expect(rep.payments.awaiting_count).toBe(1);
    expect(rep.deposit).toMatchObject({
      opening_balance: 0, contributions: 350, discrepancy_usage: -127.44, corrections: 5, refunds: -22.56, closing_balance: 205,
    });
    const rep2 = (await db.as<{ r: Record<string, any> }>(admin, `select public.get_house_report(id) as r from billing_periods where year = 2026 and month = 10`)).rows[0]!.r;
    expect(rep2.deposit.opening_balance).toBe(205);
    await expectDbError(db.as(apts[0]!.uid, `select public.get_house_report($1)`, [period]), /лише адміністратору/);
  });
});

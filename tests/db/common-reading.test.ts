/* eslint-disable @typescript-eslint/no-explicit-any -- довільна структура JSON-відповіді в тестах */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;
let resident: { apt: string; uid: string };

async function upsert(periodId: string, current: string, opts: { previous?: string; reason?: string; ack?: boolean } = {}) {
  const r = await db.as<{ r: Record<string, any> }>(
    admin,
    `select public.admin_upsert_common_reading($1, $2::numeric, $3::numeric, null, $4, $5) as r`,
    [periodId, current, opts.previous ?? null, opts.reason ?? null, opts.ack ?? false],
  );
  return r.rows[0]!.r;
}

async function rec(periodId: string): Promise<Record<string, any>> {
  return (await db.sql(`select * from reconciliation_records where billing_period_id = $1`, [periodId])).rows[0] as Record<string, any>;
}

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
  const apt = await db.createApartment(admin, "1", "Тест", "1000");
  resident = { apt, uid: await db.registerResident(admin, apt, "Тест") };
});
afterAll(async () => db?.destroy());

describe("Редагування показника загального лічильника", () => {
  it("виправлення після закриття розбіжності: з причиною, перерахунок, журнал", async () => {
    const p = await db.openPeriod(admin, 2026, 9);
    await db.submitReading(resident.uid, resident.apt, p, "1100"); // 100 кВт·год
    await upsert(p, "3555", { previous: "2555" }); // 1000
    const r0 = await rec(p);
    await db.as(admin, `select public.admin_review_reconciliation($1, 'перевірено')`, [r0.id]);
    await db.as(admin, `select public.admin_close_reconciliation($1, null)`, [r0.id]);
    expect((await rec(p)).status).toBe("closed");

    await expectDbError(upsert(p, "2755"), /вкажіть причину/);
    const res = await upsert(p, "2755", { reason: "Помилка введення: зайва одиниця" }); // 200
    expect(res.common_reading).toMatchObject({ previous_reading: 2555, current_reading: 2755, consumption_kwh: 200 });
    expect(res.reconciliation).toMatchObject({ status: "calculated", discrepancy_kwh: 100, discrepancy_amount: 432 });
    expect(res.warnings.join(" ")).toMatch(/перевірити повторно/);

    const log = await db.sql(`select actor_user_id, reason, previous_values->>'current_reading' prev, new_values->>'current_reading' next
                                from audit_logs where action_type = 'common_reading.update' order by created_at desc limit 1`);
    expect(log.rows[0]).toEqual({ actor_user_id: admin, reason: "Помилка введення: зайва одиниця", prev: "3555.00", next: "2755.00" });

    // ручний «Перерахувати» для закритої розбіжності, як і раніше, заборонено
    const r1 = await rec(p);
    await db.as(admin, `select public.admin_review_reconciliation($1, null)`, [r1.id]);
    await db.as(admin, `select public.admin_close_reconciliation($1, null)`, [r1.id]);
    await expectDbError(db.as(admin, `select public.calculate_reconciliation($1)`, [p]), /виправте показник/);
  });

  it("якщо депозит уже використано — потрібне підтвердження, журнал депозиту не змінюється", async () => {
    const p = await db.openPeriod(admin, 2026, 10);
    await db.submitReading(resident.uid, resident.apt, p, "1200", { deposit: "500" }); // 100 кВт·год
    const pay = (await db.paymentFor(resident.apt, p))!;
    await db.as(resident.uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(resident.apt, pay.id!)]);
    await db.as(admin, `select public.approve_payment($1, null)`, [pay.id]);
    await upsert(p, "2905"); // попередній = 2755 → 150 кВт·год, різниця 50 → 216 грн
    const r = await rec(p);
    await db.as(admin, `select public.admin_review_reconciliation($1, null)`, [r.id]);
    await db.as(admin, `select public.admin_apply_deposit_adjustment($1, 216, 'Покриття')`, [r.id]);
    const ledgerBefore = (await db.sql(`select count(*)::int c, sum(amount)::text s from deposit_ledger`)).rows[0];

    await expectDbError(upsert(p, "2955", { reason: "Уточнення" }), /використано 216,00 грн/, "EO409");
    const res = await upsert(p, "2955", { reason: "Уточнення", ack: true }); // 200 → різниця 100
    expect(res.reconciliation).toMatchObject({ status: "calculated", discrepancy_kwh: 100 });
    expect(res.warnings.join(" ")).toMatch(/коригування депозиту/);
    expect((await db.sql(`select count(*)::int c, sum(amount)::text s from deposit_ledger`)).rows[0]).toEqual(ledgerBefore);

    // зведення для мешканця: уже використані 216 грн не віднімаються вдруге
    const s = (await db.as<{ s: Record<string, any> }>(resident.uid, `select public.get_house_summary($1) as s`, [p])).rows[0]!.s;
    expect(s).toMatchObject({ discrepancy_amount: 432, deposit_used: 216, deposit_already_applied: true, deposit_balance: 284, deposit_after: 68 });

    // видалення заборонене, поки є списання з депозиту
    await expectDbError(db.as(admin, `select public.admin_delete_common_reading($1, 'тест')`, [p]), /Видалити неможливо.*216,00/);
  });

  it("видалення показника разом із розрахунком розбіжності", async () => {
    const p = await db.openPeriod(admin, 2026, 11);
    await upsert(p, "3100");
    await expectDbError(db.as(admin, `select public.admin_delete_common_reading($1, '')`, [p]), /причину/);
    await db.as(admin, `select public.admin_delete_common_reading($1, 'Внесено не той місяць')`, [p]);
    expect((await db.sql(`select count(*)::int c from common_meter_readings where billing_period_id = $1`, [p])).rows[0]!.c).toBe(0);
    expect(await rec(p)).toBeUndefined();
    const log = await db.sql(`select action_type, reason from audit_logs where action_type in ('common_reading.delete', 'reconciliation.delete') order by created_at`);
    expect(log.rows).toEqual([
      { action_type: "reconciliation.delete", reason: "Внесено не той місяць" },
      { action_type: "common_reading.delete", reason: "Внесено не той місяць" },
    ]);
    // мешканець бачить, що показника за цей місяць немає
    const s = (await db.as<{ s: Record<string, any> }>(resident.uid, `select public.get_house_summary($1) as s`, [p])).rows[0]!.s;
    expect(s.has_common).toBe(false);
    // повторне видалення — зрозуміла помилка
    await expectDbError(db.as(admin, `select public.admin_delete_common_reading($1, 'ще раз')`, [p]), /не знайдено/);
  });

  it("попереджає, якщо наступний місяць починається з іншого показника", async () => {
    const p = await db.openPeriod(admin, 2027, 1);
    const p2 = await db.openPeriod(admin, 2027, 2);
    await upsert(p, "4000", { previous: "3500" });
    await upsert(p2, "4400"); // попередній = 4000
    const res = await upsert(p, "4050", { reason: "Уточнення" });
    expect(res.warnings.join(" ")).toMatch(/лютий 2027 починається з 4000\.00, а не з 4050\.00/);
  });

  it("мешканець не може редагувати чи видаляти показник загального лічильника", async () => {
    const p = (await db.sql<{ id: string }>(`select id from billing_periods where year = 2026 and month = 9`)).rows[0]!.id;
    await expectDbError(db.as(resident.uid, `select public.admin_upsert_common_reading($1, 1, 0, null, 'x', true)`, [p]), /лише адміністратору/);
    await expectDbError(db.as(resident.uid, `select public.admin_delete_common_reading($1, 'xxx')`, [p]), /лише адміністратору/);
    await expectDbError(db.as(resident.uid, `delete from common_meter_readings`), /permission denied/);
    await expectDbError(db.as(resident.uid, `select public.recalculate_reconciliation_internal($1)`, [p]), /permission denied/);
  });
});

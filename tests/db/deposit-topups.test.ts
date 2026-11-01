import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;
let apt: string, uid: string, other: string, otherApt: string;
let period: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
  apt = await db.createApartment(admin, "5", "П'ята", "1000");
  uid = await db.registerResident(admin, apt, "П'ята");
  otherApt = await db.createApartment(admin, "6", "Шоста", "1000");
  other = await db.registerResident(admin, otherApt, "Шоста");
  period = await db.openPeriod(admin, 2026, 10);
});
afterAll(async () => db?.destroy());

const receipt = (aptId: string) =>
  JSON.stringify([{ storage_path: `topup/${aptId}/${randomUUID()}.pdf`, original_filename: "переказ.pdf", mime_type: "application/pdf", file_size: 4096 }]);
const submit = async (who: string, aptId: string, amount: string, note: string | null = null) =>
  (await db.as<{ id: string }>(who, `select (public.submit_deposit_topup($1, $2::numeric, $3::jsonb, $4)).id`, [aptId, amount, receipt(aptId), note])).rows[0]!.id;

describe("Окремі внески в депозит", () => {
  it("50 грн разом із показниками, а через 10 днів ще 150 грн окремо — обидва зафіксовано", async () => {
    // 50 грн — у місячному платежі разом із показниками
    await db.submitReading(uid, apt, period, "1100", { deposit: "50" });
    const pay = (await db.paymentFor(apt, period))!;
    await db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!)]);
    await db.as(admin, `select public.approve_payment($1, null)`, [pay.id]);
    expect(await db.depositBalance()).toBe("50.00");

    // приймання показників уже завершилось — окремий внесок усе одно приймається
    await db.sql(`update billing_periods set reading_window_start = now() - interval '12 days',
                                             reading_window_end = now() - interval '2 days' where id = $1`, [period]);
    const id = await submit(uid, apt, "150", "Поповнення");
    const row = (await db.sql(`select status, amount::text a, billing_period_id from deposit_topups where id = $1`, [id])).rows[0];
    expect(row).toEqual({ status: "pending_review", a: "150.00", billing_period_id: period });
    expect(await db.depositBalance()).toBe("50.00"); // до підтвердження — не зараховано

    await db.as(admin, `select public.admin_approve_deposit_topup($1, 'Надійшло на конверт')`, [id]);
    await db.as(admin, `select public.admin_approve_deposit_topup($1, null)`, [id]); // повторно — без подвійного зарахування
    expect(await db.depositBalance()).toBe("200.00");

    const ledger = await db.sql(`select amount::text a, related_payment_id is not null as from_payment, related_topup_id is not null as from_topup
                                   from deposit_ledger where apartment_id = $1 order by created_at`, [apt]);
    expect(ledger.rows).toEqual([
      { a: "50.00", from_payment: true, from_topup: false },
      { a: "150.00", from_payment: false, from_topup: true },
    ]);
    const log = await db.sql(`select action_type from audit_logs where action_type like 'deposit_topup.%' order by created_at`);
    expect(log.rows.map((r) => r.action_type)).toEqual(["deposit_topup.submit", "deposit_topup.approve"]);
  });

  it("перевірки: сума, квитанція, чужа квартира, видимість, відхилення", async () => {
    await expectDbError(submit(uid, apt, "0"), /додатною/);
    await expectDbError(submit(uid, apt, "10.005"), /копійок/);
    await expectDbError(
      db.as(uid, `select public.submit_deposit_topup($1, 100, '[]'::jsonb, null)`, [apt]),
      /Прикріпіть квитанцію/,
    );
    // шлях файлу має належати своїй квартирі
    await expectDbError(
      db.as(uid, `select public.submit_deposit_topup($1, 100, $2::jsonb, null)`, [apt, receipt(otherApt)]),
      /Некоректний шлях/,
    );
    await expectDbError(submit(uid, otherApt, "100"), /Немає доступу/);
    // мешканець не підтверджує
    const id = await submit(other, otherApt, "75");
    await expectDbError(db.as(other, `select public.admin_approve_deposit_topup($1, null)`, [id]), /лише адміністратору/);
    // видимість: своє — так, чуже — ні
    const mine = await db.as(uid, `select id from deposit_topups`);
    expect(mine.rows.every((r) => r.id !== id)).toBe(true);
    const theirs = await db.as(other, `select id from deposit_topups`);
    expect(theirs.rows.map((r) => r.id)).toEqual([id]);
    const receiptsSeen = await db.as(uid, `select id from deposit_topup_receipts r where r.topup_id = $1`, [id]);
    expect(receiptsSeen.rows).toEqual([]);

    await expectDbError(db.as(admin, `select public.admin_reject_deposit_topup($1, '')`, [id]), /причину/);
    await db.as(admin, `select public.admin_reject_deposit_topup($1, 'Переказ не надійшов')`, [id]);
    await expectDbError(db.as(admin, `select public.admin_approve_deposit_topup($1, null)`, [id]), /відхилено/);
    expect(await db.depositBalance()).toBe("200.00");
    // підтверджений не можна відхилити
    const paidId = (await db.sql(`select id from deposit_topups where status = 'paid'`)).rows[0]!.id;
    await expectDbError(db.as(admin, `select public.admin_reject_deposit_topup($1, 'спроба')`, [paidId]), /уже підтверджено/);
  });

  it("повторне застосування міграції не змінює внесків і журналу депозиту", async () => {
    const snap = async () => ({
      topups: (await db.sql(`select * from deposit_topups order by id`)).rows,
      ledger: (await db.sql(`select * from deposit_ledger order by id`)).rows,
      payments: (await db.sql(`select * from payments order by id`)).rows,
    });
    const before = await snap();
    await db.sql(readFileSync(new URL("../../supabase/migrations/20261101000008_deposit_topups.sql", import.meta.url), "utf8"));
    expect(await snap()).toEqual(before);
  });
});

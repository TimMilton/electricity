import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;
let period: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
  period = await db.openPeriod(admin, 2026, 9);
});
afterAll(async () => db?.destroy());

async function residentWithCharge(num: string, surname: string, deposit = "100") {
  const apt = await db.createApartment(admin, num, surname, "1000");
  const uid = await db.registerResident(admin, apt, surname);
  await db.submitReading(uid, apt, period, "1100", { deposit, hall: "20" });
  const pay = (await db.paymentFor(apt, period))!;
  return { apt, uid, pay };
}

describe("Оплата, квитанції та перевірка", () => {
  it("13–14. подання на перевірку з квитанцією; захист від дублювання", async () => {
    const { apt, uid, pay } = await residentWithCharge("21", "Іваненко");
    expect(pay.status).toBe("awaiting_payment");
    expect(pay.total_amount).toBe("552.00"); // 432 + 100 + 20

    // без квитанції подати не можна
    await expectDbError(db.as(uid, `select public.submit_payment_for_review($1, '[]'::jsonb)`, [pay.id]), /Завантажте квитанцію/);
    // шлях до чужої теки відхиляється
    await expectDbError(
      db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson("00000000-0000-0000-0000-000000000000", pay.id!)]),
      /Некоректний шлях/,
    );
    // недозволений тип
    const bad = JSON.stringify([{ storage_path: `${apt}/${pay.id}/x.exe`, original_filename: "x.exe", mime_type: "application/x-msdownload", file_size: 10 }]);
    await expectDbError(db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, bad]), /Недозволений формат/);
    // завеликий файл
    const big = JSON.stringify([{ storage_path: `${apt}/${pay.id}/x.pdf`, original_filename: "x.pdf", mime_type: "application/pdf", file_size: 11 * 1024 * 1024 }]);
    await expectDbError(db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, big]), /перевищує 10 МБ/);

    const r = await db.as(uid, `select status, attempt_no from public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!)]);
    expect(r.rows[0]).toEqual({ status: "pending_review", attempt_no: 1 });

    // повторне надсилання поки платіж на перевірці
    await expectDbError(db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!)]), /уже на перевірці/);
    // зміна показників після подання заблокована для мешканця
    await expectDbError(db.submitReading(uid, apt, period, "1200"), /уже подано на перевірку/);
    // депозит ще не поповнено
    expect(await db.depositBalance()).toBe("0.00");
    // мешканець не може сам підтвердити чи змінити статус
    await expectDbError(db.as(uid, `select public.approve_payment($1, null)`, [pay.id]), /лише адміністратору/);
    await expectDbError(db.as(uid, `update payments set status = 'paid' where id = $1`, [pay.id]), /permission denied/);
  });

  it("15, 19, 20. підтвердження зараховує депозит рівно один раз (ідемпотентність)", async () => {
    const { apt, uid, pay } = await residentWithCharge("22", "Петрук", "75.50");
    await db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!)]);
    const before = Number(await db.depositBalance());

    const a1 = await db.as<{ r: { already_paid: boolean; deposit_entry_id: string | null } }>(admin, `select public.approve_payment($1, null) as r`, [pay.id]);
    expect(a1.rows[0]!.r.already_paid).toBe(false);
    expect(a1.rows[0]!.r.deposit_entry_id).toBeTruthy();
    const a2 = await db.as<{ r: { already_paid: boolean } }>(admin, `select public.approve_payment($1, null) as r`, [pay.id]);
    expect(a2.rows[0]!.r.already_paid).toBe(true);

    // паралельні підтвердження
    await Promise.all([1, 2, 3].map(() => db.as(admin, `select public.approve_payment($1, null)`, [pay.id])));

    const led = await db.sql(`select count(*)::int c, sum(amount)::text s from deposit_ledger where related_payment_id = $1`, [pay.id]);
    expect(led.rows[0]).toEqual({ c: 1, s: "75.50" });
    expect(Number(await db.depositBalance())).toBeCloseTo(before + 75.5, 2);

    const p = (await db.paymentFor(apt, period))!;
    expect(p).toMatchObject({ status: "paid", reviewed_by: admin, confirmed_without_receipt: false });
    const audit = await db.sql(`select count(*)::int c from audit_logs where action_type = 'payment.approve' and entity_id = $1`, [pay.id]);
    expect(audit.rows[0]!.c).toBe(1);

    // підтверджений платіж не відхиляється
    await expectDbError(db.as(admin, `select public.reject_payment($1, 'помилка')`, [pay.id]), /не можна відхилити/);
    // унікальний індекс гарантує одне зарахування навіть при прямому записі
    await expectDbError(
      db.sql(`insert into deposit_ledger (billing_period_id, apartment_id, transaction_type, amount, description, related_payment_id, created_by)
              values ($1, $2, 'contribution', 75.50, 'дубль', $3, $4)`, [period, apt, pay.id, admin]),
      /duplicate key/,
    );
  });

  it("16. підтвердження без квитанції вимагає примітки та фіксує ознаку", async () => {
    const { apt, pay } = await residentWithCharge("23", "Сидоренко", "0");
    await expectDbError(db.as(admin, `select public.approve_payment($1, null)`, [pay.id]), /потребує примітки/);
    await db.as(admin, `select public.approve_payment($1, 'Оплачено готівкою старшому по будинку')`, [pay.id]);
    const p = (await db.paymentFor(apt, period))!;
    expect(p).toMatchObject({ status: "paid", confirmed_without_receipt: true, admin_note: "Оплачено готівкою старшому по будинку" });
    // депозит 0 — запису в журналі немає
    const led = await db.sql(`select count(*)::int c from deposit_ledger where related_payment_id = $1`, [pay.id]);
    expect(led.rows[0]!.c).toBe(0);
  });

  it("17–18. відхилення з причиною; повторне подання без нового нарахування; історія спроб", async () => {
    const { apt, uid, pay } = await residentWithCharge("24", "Захарченко");
    await db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!, "first.pdf")]);
    await expectDbError(db.as(admin, `select public.reject_payment($1, '')`, [pay.id]), /причину/);
    await db.as(admin, `select public.reject_payment($1, 'Сума не надійшла на конверт')`, [pay.id]);

    const own = await db.as(uid, `select status, rejection_reason from payments where id = $1`, [pay.id]);
    expect(own.rows[0]).toEqual({ status: "rejected", rejection_reason: "Сума не надійшла на конверт" });
    // депозит не поповнюється відхиленим платежем
    const led = await db.sql(`select count(*)::int c from deposit_ledger where related_payment_id = $1`, [pay.id]);
    expect(led.rows[0]!.c).toBe(0);

    // мешканець може виправити внески після відхилення (вікно відкрите) і подати повторно
    await db.submitReading(uid, apt, period, "1100", { deposit: "100", hall: "25" });
    await db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!, "second.pdf")]);
    const p = (await db.paymentFor(apt, period))!;
    expect(p).toMatchObject({ id: pay.id, status: "pending_review", attempt_no: 2, rejection_reason: null, total_amount: "557.00" });
    const count = await db.sql(`select count(*)::int c from payments where apartment_id = $1`, [apt]);
    expect(count.rows[0]!.c).toBe(1);

    const events = await db.as(uid, `select event_type, attempt_no, reason from payment_events where payment_id = $1 order by created_at`, [pay.id]);
    expect(events.rows.map((e) => e.event_type)).toEqual(["created", "submitted", "rejected", "amounts_updated", "submitted"]);
    const receipts = await db.as(uid, `select original_filename, attempt_no from receipts where payment_id = $1 order by created_at`, [pay.id]);
    expect(receipts.rows).toEqual([
      { original_filename: "first.pdf", attempt_no: 1 },
      { original_filename: "second.pdf", attempt_no: 2 },
    ]);
  });

  it("28. квитанції та платежі видно лише власнику та адміністратору", async () => {
    const a = await residentWithCharge("25", "Левченко");
    const b = await residentWithCharge("26", "Яковенко");
    await db.as(a.uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [a.pay.id, db.receiptJson(a.apt, a.pay.id!)]);
    const path = (await db.sql<{ storage_path: string }>(`select storage_path from receipts where payment_id = $1`, [a.pay.id])).rows[0]!.storage_path;

    expect((await db.as(b.uid, `select * from receipts where payment_id = $1`, [a.pay.id])).rowCount).toBe(0);
    expect((await db.as(b.uid, `select * from payments where id = $1`, [a.pay.id])).rowCount).toBe(0);
    expect((await db.as(b.uid, `select * from payment_events where payment_id = $1`, [a.pay.id])).rowCount).toBe(0);
    expect((await db.as(a.uid, `select * from receipts where payment_id = $1`, [a.pay.id])).rowCount).toBe(1);
    expect((await db.as(admin, `select * from receipts where payment_id = $1`, [a.pay.id])).rowCount).toBe(1);

    // політики Storage
    await db.sql(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [path]);
    expect((await db.as(b.uid, `select name from storage.objects where name = $1`, [path])).rowCount).toBe(0);
    expect((await db.as(a.uid, `select name from storage.objects where name = $1`, [path])).rowCount).toBe(1);
    expect((await db.as(admin, `select name from storage.objects where name = $1`, [path])).rowCount).toBe(1);
    await expectDbError(db.asAnon(`select name from storage.objects`), /permission denied/);
    // B не може завантажити файл у теку A
    await expectDbError(
      db.as(b.uid, `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${a.apt}/${a.pay.id}/evil.pdf`]),
      /row-level security/,
    );
    // власник може дозавантажити до власного платежу
    await db.as(a.uid, `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${a.apt}/${a.pay.id}/more.pdf`]);
    // видаляти квитанції не може ніхто з користувачів
    const del = await db.as(a.uid, `delete from storage.objects where name = $1`, [path]);
    expect(del.rowCount).toBe(0);
    await expectDbError(db.as(a.uid, `delete from receipts where payment_id = $1`, [a.pay.id]), /permission denied/);

    // мешканець B не може додати квитанцію до чужого платежу через функцію
    await expectDbError(db.as(b.uid, `select public.add_payment_receipts($1, $2::jsonb)`, [a.pay.id, db.receiptJson(a.apt, a.pay.id!)]), /Немає доступу/);
    // адміністратор — може
    expect((await db.as<{ n: number }>(admin, `select public.add_payment_receipts($1, $2::jsonb) as n`, [a.pay.id, db.receiptJson(a.apt, a.pay.id!)])).rows[0]!.n).toBe(1);
  });

  it("Загальна таблиця місяця не розкриває приватні поля платежів", async () => {
    const a = await residentWithCharge("27", "Гребенюк");
    await db.as(admin, `select public.reject_payment($1, 'Приватна причина')`, [a.pay.id]);
    const other = await residentWithCharge("28", "Нестеренко");
    const rows = await db.as(other.uid, `select * from public.get_period_table($1)`, [period]);
    const row = rows.rows.find((r) => r.apartment_id === a.apt)!;
    expect(row.payment_status).toBe("rejected");
    expect(row.is_own).toBe(false);
    expect(JSON.stringify(rows.rows)).not.toContain("Приватна причина");
    expect(Object.keys(row)).not.toContain("rejection_reason");
    expect(Object.keys(row)).not.toContain("admin_note");
  });
});

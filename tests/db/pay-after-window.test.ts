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

describe("Оплата після завершення приймання показників", () => {
  it("показники — лише у вікно; оплатити й додати квитанцію можна після 5 числа і навіть після закриття періоду", async () => {
    const apt = await db.createApartment(admin, "7", "Сьома", "1000");
    const uid = await db.registerResident(admin, apt, "Сьома");
    const oct = await db.openPeriod(admin, 2026, 10);
    await db.submitReading(uid, apt, oct, "1100", { deposit: "20", hall: "10" });

    // приймання завершилось (як після 5 числа)
    await db.sql(`update billing_periods set reading_window_start = now() - interval '6 days',
                                             reading_window_end = now() - interval '1 hour' where id = $1`, [oct]);
    await expectDbError(db.submitReading(uid, apt, oct, "1110"), /завершився/);

    // новий місяць уже створено — він став «поточним», але оплату за жовтень це не блокує
    const nov = await db.as<{ id: string }>(admin,
      `select (public.admin_create_period(2026, 11, now() + interval '20 days', now() + interval '25 days', true)).id`);
    const cur = await db.as<{ id: string }>(uid, `select (public.get_current_period()).id`);
    expect(cur.rows[0]!.id).toBe(nov.rows[0]!.id);

    const pay = (await db.paymentFor(apt, oct))!;
    expect(pay.status).toBe("awaiting_payment");
    // мешканець бачить неоплачене нарахування за жовтень (так його знаходить сторінка оплати)
    const unpaid = await db.as<{ billing_period_id: string; total_amount: string }>(uid,
      `select billing_period_id, total_amount::text from payments
        where apartment_id = $1 and status in ('awaiting_payment', 'rejected') and total_amount > 0`, [apt]);
    expect(unpaid.rows).toEqual([{ billing_period_id: oct, total_amount: "462.00" }]);

    // адміністратор закрив період — оплата все одно приймається
    await db.as(admin, `select public.admin_close_period($1, null)`, [oct]);
    await db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!)]);
    await db.as(uid, `select public.add_payment_receipts($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!, "ще.pdf")]);
    expect((await db.paymentFor(apt, oct))!.status).toBe("pending_review");

    // завантаження файлу у сховище для цього платежу дозволене (політика Storage)
    const can = await db.as<{ ok: boolean }>(uid, `select public.can_access_receipt_object($1, true) ok`, [`${apt}/${pay.id}/x.pdf`]);
    expect(can.rows[0]!.ok).toBe(true);

    // відхилили — можна надіслати повторно після закриття
    await db.as(admin, `select public.reject_payment($1, 'Не знайдено переказ')`, [pay.id]);
    await db.as(uid, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(apt, pay.id!, "новий.pdf")]);
    await db.as(admin, `select public.approve_payment($1, null)`, [pay.id]);
    expect((await db.paymentFor(apt, oct))!.status).toBe("paid");
  });
});

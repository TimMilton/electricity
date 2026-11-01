import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;
let uid: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  const apt = await db.createApartment(admin, "1", "Перша", "0");
  uid = await db.registerResident(admin, apt, "Перша");
});
afterAll(async () => db?.destroy());

const file = (periodId: string, name = "kvytantsia.pdf") =>
  JSON.stringify([{ storage_path: `house/${periodId}/${randomUUID()}.pdf`, original_filename: name, mime_type: "application/pdf", file_size: 2048 }]);
const visible = async (who: string, periodId: string) =>
  (await db.as<{ original_filename: string }>(who, `select original_filename from house_receipts where billing_period_id = $1`, [periodId])).rows.map((r) => r.original_filename);

describe("Квитанція про оплату за загальним лічильником", () => {
  it("завантажує лише адміністратор; мешканці бачать після закриття періоду (вручну або автоматично)", async () => {
    const oct = await db.openPeriod(admin, 2026, 10);
    // мешканцю — заборонено
    await expectDbError(db.as(uid, `select public.admin_add_house_receipts($1, $2::jsonb, null)`, [oct, file(oct)]), /лише адміністратору/);
    // шлях має належати цьому періоду
    const other = randomUUID();
    await expectDbError(db.as(admin, `select public.admin_add_house_receipts($1, $2::jsonb, null)`, [oct, file(other)]), /Некоректний шлях/);

    await db.as(admin, `select public.admin_add_house_receipts($1, $2::jsonb, 'Оплачено 07.11')`, [oct, file(oct, "жовтень.pdf")]);
    expect(await visible(admin, oct)).toEqual(["жовтень.pdf"]);
    expect(await visible(uid, oct)).toEqual([]); // період відкритий — мешканцю не видно

    await db.as(admin, `select public.admin_close_period($1, 'Місяць завершено')`, [oct]);
    expect(await visible(uid, oct)).toEqual(["жовтень.pdf"]);

    // автоматичне закриття після завершення приймання
    const sep = await db.openPeriod(admin, 2026, 9);
    await db.as(admin, `select public.admin_add_house_receipts($1, $2::jsonb, null)`, [sep, file(sep, "вересень.pdf")]);
    expect(await visible(uid, sep)).toEqual([]);
    await db.sql(`update billing_periods set reading_window_start = now() - interval '6 days',
                                             reading_window_end = now() - interval '1 minute' where id = $1`, [sep]);
    await db.as(uid, `select public.get_current_period()`); // синхронізує статуси, як під час відкриття сторінки
    expect(await visible(uid, sep)).toEqual(["вересень.pdf"]);

    const log = await db.sql(`select count(*)::int c from audit_logs where action_type = 'house_receipt.add'`);
    expect(log.rows[0]!.c).toBe(2);
  });

  it("видалення — лише адміністратор, з причиною і записом у журнал; повертає шлях файлу", async () => {
    const id = (await db.sql(`select id, storage_path from house_receipts where original_filename = 'вересень.pdf'`)).rows[0]!;
    await expectDbError(db.as(uid, `select public.admin_delete_house_receipt($1, 'тест')`, [id.id]), /лише адміністратору/);
    await expectDbError(db.as(admin, `select public.admin_delete_house_receipt($1, '')`, [id.id]), /причину/);
    const path = (await db.as<{ p: string }>(admin, `select public.admin_delete_house_receipt($1, 'Не той файл') p`, [id.id])).rows[0]!.p;
    expect(path).toBe(id.storage_path);
    const log = await db.sql(`select reason from audit_logs where action_type = 'house_receipt.delete'`);
    expect(log.rows).toEqual([{ reason: "Не той файл" }]);
  });

  it("повторне застосування міграції не змінює наявних квитанцій", async () => {
    const before = (await db.sql(`select * from house_receipts order by id`)).rows;
    await db.sql(readFileSync(new URL("../../supabase/migrations/20261101000006_house_receipts.sql", import.meta.url), "utf8"));
    expect((await db.sql(`select * from house_receipts order by id`)).rows).toEqual(before);
  });
});

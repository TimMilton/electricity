import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
});
afterAll(async () => db?.destroy());

describe("Під'їзд квартири", () => {
  it("мешканець вказує під'їзд своєї квартири; видно в загальній таблиці; журнал змін", async () => {
    const a1 = await db.createApartment(admin, "1", "Перша", "0");
    const a2 = await db.createApartment(admin, "2", "Друга", "0");
    const u1 = await db.registerResident(admin, a1, "Перша");
    const u2 = await db.registerResident(admin, a2, "Друга");
    const p = await db.openPeriod(admin, 2026, 10);

    const table = async (uid: string) =>
      (await db.as<{ apartment_number: string; entrance: number | null }>(uid,
        `select apartment_number, entrance from public.get_period_table($1) order by apartment_number`, [p])).rows;
    expect(await table(u1)).toEqual([{ apartment_number: "1", entrance: null }, { apartment_number: "2", entrance: null }]);

    await db.as(u1, `select public.set_apartment_entrance($1, 2)`, [a1]);
    expect(await table(u2)).toEqual([{ apartment_number: "1", entrance: 2 }, { apartment_number: "2", entrance: null }]);

    // можна змінити
    await db.as(u1, `select public.set_apartment_entrance($1, 3)`, [a1]);
    const log = await db.sql(`select actor_user_id, previous_values, new_values from audit_logs
                               where action_type = 'apartment.entrance_set' order by created_at`);
    expect(log.rows.map((r) => [r.previous_values, r.new_values])).toEqual([
      [{ entrance: null }, { entrance: 2 }],
      [{ entrance: 2 }, { entrance: 3 }],
    ]);
    expect(log.rows[0]!.actor_user_id).toBe(u1);

    // лише 1–3
    await expectDbError(db.as(u1, `select public.set_apartment_entrance($1, 4)`, [a1]), /1, 2 або 3/);
    await expectDbError(db.as(u1, `select public.set_apartment_entrance($1, 0)`, [a1]), /1, 2 або 3/);
    // не для чужої квартири
    await expectDbError(db.as(u1, `select public.set_apartment_entrance($1, 1)`, [a2]), /Немає доступу/);
    // адміністратор — для будь-якої
    await db.as(admin, `select public.set_apartment_entrance($1, 1)`, [a2]);
    expect(await table(u1)).toEqual([{ apartment_number: "1", entrance: 3 }, { apartment_number: "2", entrance: 1 }]);
  });
});

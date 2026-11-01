import { afterAll, beforeAll, expect, it } from "vitest";
import { TestDb } from "./helpers";

let db: TestDb;
let admin: string;
beforeAll(async () => { db = await TestDb.create(); admin = await db.createAdmin(); });
afterAll(async () => db?.destroy());

it("три тарифи (17.10, 30.10, 01.11): зміна першого на 01.10 робить жовтень розрахунковим; зайві можна видалити", async () => {
  const oct = await db.openPeriod(admin, 2026, 10);
  for (const d of ["2026-10-17", "2026-10-30", "2026-11-01"]) await db.setTariff(admin, "4.32", d);
  const tariffFor = async () => (await db.as<{ t: string | null }>(admin, `select public.get_applicable_tariff($1)::text t`, [oct])).rows[0]!.t;
  expect(await tariffFor()).toBeNull();
  const ids = (await db.sql(`select id from tariffs order by valid_from`)).rows.map((r) => r.id as string);
  await db.as(admin, `select public.admin_update_tariff($1, 4.32, '2026-10-01', 'Старий місяць')`, [ids[0]]);
  expect(await tariffFor()).toBe("4.3200");
  await db.as(admin, `select public.admin_delete_tariff($1, 'Дублікат')`, [ids[1]]);
  await db.as(admin, `select public.admin_delete_tariff($1, 'Дублікат')`, [ids[2]]);
  expect((await db.sql(`select valid_from::text f, valid_until::text u from tariffs`)).rows).toEqual([{ f: "2026-10-01", u: null }]);
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
});
afterAll(async () => db?.destroy());

describe("Системні задачі та поточний період", () => {
  it("автоматично створює період за типовими налаштуваннями лише один раз", async () => {
    const a = await db.asService<{ year: number; month: number; id: string }>(`select id, year, month from public.system_ensure_current_period()`);
    const b = await db.asService<{ id: string }>(`select id from public.system_ensure_current_period()`);
    expect(b.rows[0]!.id).toBe(a.rows[0]!.id);
    const cnt = await db.sql(`select count(*)::int c from billing_periods`);
    expect(cnt.rows[0]!.c).toBe(1);
    const log = await db.sql(`select actor_role, reason from audit_logs where action_type = 'period.create'`);
    expect(log.rows[0]).toMatchObject({ actor_role: "system" });
    // недоступно звичайним користувачам
    await expectDbError(db.as(admin, `select public.system_ensure_current_period()`), /permission denied/);
  });

  it("поточний період: відкритий має пріоритет над запланованим і минулим", async () => {
    await db.as(admin, `select public.admin_create_period(2031, 1, now() + interval '3 days', now() + interval '6 days', true)`);
    const open = await db.openPeriod(admin, 2030, 12);
    const cur = await db.as<{ id: string }>(admin, `select (public.get_current_period()).id`);
    expect(cur.rows[0]!.id).toBe(open);
    await db.as(admin, `select public.admin_close_period($1, null)`, [open]);
    const next = await db.as<{ year: number; month: number }>(admin, `select (p).year, (p).month from (select public.get_current_period() p) x`);
    expect(next.rows[0]).toEqual({ year: 2031, month: 1 });
  });

  it("створення наступного періоду за типовими датами", async () => {
    const r = await db.as<{ year: number; month: number }>(admin, `select year, month from public.admin_create_next_period()`);
    expect(r.rows[0]).toEqual({ year: 2031, month: 2 });
  });
});

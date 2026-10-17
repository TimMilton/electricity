import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
});
afterAll(async () => db?.destroy());

async function code(aptId: string, additional = false) {
  const r = await db.as<{ c: string }>(admin, `select public.admin_generate_registration_code($1, $2) as c`, [aptId, additional]);
  return r.rows[0]!.c;
}

async function verify(num: string, surname: string, c: string) {
  const r = await db.asService<{ r: { ok: boolean; reason?: string; apartment_id?: string } }>(
    `select public.registration_verify($1, $2, $3) as r`, [num, surname, c]);
  return r.rows[0]!.r;
}

describe("Самостійна реєстрація та перевірка квартири", () => {
  it("1–2. реєструє мешканця з правильним кодом, номером і прізвищем; код одноразовий", async () => {
    const apt = await db.createApartment(admin, "10", "Шевченко");
    const c = await code(apt);
    expect(c).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);

    // код у базі зберігається лише як хеш
    const stored = await db.sql<{ h: string }>(`select registration_code_hash h from apartments where id = $1`, [apt]);
    expect(stored.rows[0]!.h).not.toContain(c.replace("-", ""));
    expect(stored.rows[0]!.h.startsWith("$2")).toBe(true);

    // регістр, пробіли та дефіс у коді не важливі; апостроф і регістр у прізвищі нормалізуються
    const v = await verify(" 10 ", "шевченко", c.toLowerCase().replace("-", " "));
    expect(v.ok).toBe(true);
    expect(v.apartment_id).toBe(apt);

    const uid = await db.createAuthUser();
    await db.asService(`select public.registration_complete($1, $2, $3, $4)`, [uid, apt, "Шевченко", c]);
    const p = await db.sql(`select role, apartment_id, is_primary from profiles where auth_user_id = $1`, [uid]);
    expect(p.rows[0]).toMatchObject({ role: "resident", apartment_id: apt, is_primary: true });

    const a = await db.sql(`select registration_status, registration_code_hash from apartments where id = $1`, [apt]);
    expect(a.rows[0]).toMatchObject({ registration_status: "registered", registration_code_hash: null });

    // повторне використання того самого коду неможливе
    const again = await verify("10", "Шевченко", c);
    expect(again.ok).toBe(false);
  });

  it("2. неправильні дані дають однакову загальну відповідь без розкриття прізвища", async () => {
    const apt = await db.createApartment(admin, "11", "Коваленко");
    const c = await code(apt);
    const wrongSurname = await verify("11", "Іваненко", c);
    const wrongCode = await verify("11", "Коваленко", "AAAAA-BBBBB");
    const noApartment = await verify("999", "Коваленко", c);
    for (const r of [wrongSurname, wrongCode, noApartment]) {
      expect(r).toEqual({ ok: false, reason: "invalid" });
      expect(JSON.stringify(r)).not.toContain("Коваленко");
    }
  });

  it("2. блокує перевірку після перевищення кількості спроб", async () => {
    await db.as(admin, `select public.admin_update_settings('{"registration_code_max_attempts": 3}'::jsonb, null)`);
    const apt = await db.createApartment(admin, "12", "Бондар");
    const c = await code(apt);
    for (let i = 0; i < 3; i++) expect((await verify("12", "Бондар", "WRONG-CODE0")).ok).toBe(false);
    // навіть правильний код тепер не приймається
    expect(await verify("12", "Бондар", c)).toEqual({ ok: false, reason: "locked" });
    // новий код від адміністратора знімає блокування
    const c2 = await code(apt);
    expect((await verify("12", "Бондар", c2)).ok).toBe(true);
    await db.as(admin, `select public.admin_update_settings('{"registration_code_max_attempts": 5}'::jsonb, null)`);
  });

  it("3. забороняє повторну реєстрацію вже прив'язаної квартири", async () => {
    const apt = await db.createApartment(admin, "13", "Мельник");
    await db.registerResident(admin, apt, "Мельник");
    // новий код без дозволу на додатковий акаунт не генерується
    await expectDbError(db.as(admin, `select public.admin_generate_registration_code($1, false)`, [apt]), /вже має активний/);
    // перевірка зареєстрованої квартири — відмова
    expect((await verify("13", "Мельник", "ANY00-CODE0")).ok).toBe(false);

    // гонка: два користувачі з одним кодом — лише один профіль
    const apt2 = await db.createApartment(admin, "14", "Ткаченко");
    const c = await code(apt2);
    const u1 = await db.createAuthUser();
    const u2 = await db.createAuthUser();
    await db.asService(`select public.registration_complete($1, $2, $3, $4)`, [u1, apt2, "Ткаченко", c]);
    await expectDbError(
      db.asService(`select public.registration_complete($1, $2, $3, $4)`, [u2, apt2, "Ткаченко", c]),
      /вже має зареєстрований/,
    );
  });

  it("3. додатковий акаунт — лише з дозволу адміністратора", async () => {
    const apt = await db.createApartment(admin, "15", "Кравець");
    await db.registerResident(admin, apt, "Кравець");
    const c = await code(apt, true);
    expect((await verify("15", "Кравець", c)).ok).toBe(true);
    const uid = await db.createAuthUser();
    await db.asService(`select public.registration_complete($1, $2, $3, $4)`, [uid, apt, "Кравець", c]);
    const p = await db.sql(`select is_primary from profiles where auth_user_id = $1`, [uid]);
    expect(p.rows[0]!.is_primary).toBe(false);
  });

  it("4.4. самостійно стати адміністратором неможливо", async () => {
    const apt = await db.createApartment(admin, "16", "Олійник");
    const uid = await db.registerResident(admin, apt, "Олійник");
    // прямий запис до profiles заборонений
    await expectDbError(db.as(uid, `update profiles set role = 'admin' where auth_user_id = $1`, [uid]), /permission denied/);
    await expectDbError(
      db.as(uid, `insert into profiles (auth_user_id, surname, role) values ($1, 'X', 'admin')`, [uid]),
      /permission denied/,
    );
    // функції реєстрації та bootstrap недоступні звичайному користувачу
    await expectDbError(db.as(uid, `select public.bootstrap_admin($1, 'x')`, [uid]), /permission denied/);
    await expectDbError(db.as(uid, `select public.registration_verify('16', 'Олійник', 'x')`), /permission denied/);
    await expectDbError(db.asAnon(`select public.registration_verify('16', 'Олійник', 'x')`), /permission denied/);
    // зміна ролі через адміністративну функцію недоступна мешканцю
    const pid = (await db.sql(`select id from profiles where auth_user_id = $1`, [uid])).rows[0]!.id;
    await expectDbError(db.as(uid, `select public.admin_set_profile_role($1, 'admin', 'хочу')`, [pid]), /лише адміністратору/);
    // навіть суперкористувач не змінить роль без адміністративної функції (тригер)
    await expectDbError(db.sql(`update profiles set role = 'admin' where id = $1`, [pid]), /Зміна ролі/);
  });

  it("Мешканець не бачить хеш коду та службові поля квартир", async () => {
    const apt = await db.createApartment(admin, "17", "Лисенко");
    const uid = await db.registerResident(admin, apt, "Лисенко");
    await expectDbError(db.as(uid, `select registration_code_hash from apartments`), /permission denied/);
    const r = await db.as(uid, `select apartment_number, resident_surname from apartments order by sort_num`);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("Rate limiting обмежує кількість спроб у вікні", async () => {
    const hits: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await db.asService<{ ok: boolean }>(`select public.check_rate_limit('test:ip', 3, 60) as ok`);
      hits.push(r.rows[0]!.ok);
    }
    expect(hits).toEqual([true, true, true, false]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";
import { apartmentLoginEmail } from "../../src/lib/access-code";

let db: TestDb;
let admin: string;
const VERSION = "2026-11-07-2";

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
});
afterAll(async () => db?.destroy());

async function resident(number: string, surname: string): Promise<{ apt: string; uid: string }> {
  const apt = await db.createApartment(admin, number, surname);
  const uid = await db.createAuthUser(apartmentLoginEmail(apt));
  await db.as(admin, `select public.admin_register_access_code($1, $2)`, [apt, uid]);
  return { apt, uid };
}

async function status(uid: string): Promise<{ ok: boolean; version: string; granted_at: string | null }> {
  return (await db.as<{ s: { ok: boolean; version: string; granted_at: string | null } }>(uid, `select public.my_consent_status() as s`)).rows[0]!.s;
}

function record(uid: string, version = VERSION) {
  return db.asService(`select public.system_record_consent($1, $2, $3, $4, $5)`, [uid, version, "a".repeat(64), "10.0.0.1", "test"]);
}

describe("Згода на обробку персональних даних", () => {
  it("без згоди статус «ні»; згода поточної редакції — «так»", async () => {
    const { uid } = await resident("101", "Петренко");
    expect((await status(uid)).ok).toBe(false);
    await record(uid);
    const s = await status(uid);
    expect(s.ok).toBe(true);
    expect(s.version).toBe(VERSION);
    expect(s.granted_at).not.toBeNull();
  });

  it("згоду іншої редакції не приймає; записує лише сервер", async () => {
    const { uid } = await resident("102", "Мельник");
    await expectDbError(record(uid, "2000-01-01"), /Текст згоди оновлено/);
    await expectDbError(
      db.as(uid, `select public.system_record_consent($1, $2, null, null, null)`, [uid, VERSION]),
      /permission denied/,
    );
  });

  it("записи згоди незмінні; мешканець бачить лише свої", async () => {
    const a = await resident("103", "Бойко");
    const b = await resident("104", "Ткаченко");
    await record(a.uid);
    await record(b.uid);
    const own = await db.as<{ n: string }>(a.uid, `select count(*)::text as n from public.personal_data_consents`);
    expect(own.rows[0]!.n).toBe("1");
    await expectDbError(db.sql(`update public.personal_data_consents set note = 'x'`), /не можна змінювати/);
    await expectDbError(db.sql(`delete from public.personal_data_consents`), /не можна змінювати/);
  });

  it("мешканець сам видаляє дані: прізвище зникає скрізь, у т. ч. з журналу змін", async () => {
    const { apt, uid } = await resident("105", "Шевчук");
    await db.as(admin, `select public.admin_upsert_apartment($1, '105', 'Шевчук', true, 10, null, 'Шевчук уточнив показник')`, [apt]);
    await record(uid);
    const r = (await db.as<{ r: { accounts_deactivated: number } }>(uid, `select public.resident_erase_my_personal_data() as r`)).rows[0]!.r;
    expect(r.accounts_deactivated).toBe(1);

    const a = (await db.sql(`select resident_surname from apartments where id = $1`, [apt])).rows[0]!;
    expect(a.resident_surname).toBeNull();
    const p = (await db.sql(`select surname, is_active from profiles where auth_user_id = $1`, [uid])).rows[0]!;
    expect(p).toMatchObject({ surname: null, is_active: false });
    const left = await db.sql(
      `select count(*)::int as n from audit_logs
        where coalesce(previous_values::text, '') || coalesce(new_values::text, '') || coalesce(reason, '') ilike '%шевчук%'`,
    );
    expect(left.rows[0]!.n).toBe(0);
    expect((await status(uid)).ok).toBe(false);
    // вхід за номером квартири більше неможливий
    const login = await db.asService<{ e: string | null }>(`select public.system_login_email_for_apartment('105') as e`);
    expect(login.rows[0]!.e).toBeNull();
    // журнал змін і далі незмінний
    await expectDbError(db.sql(`update audit_logs set reason = 'x'`), /не можна змінювати/);
  });

  it("адміністратор видаляє дані на прохання мешканця; підстава обов'язкова й теж очищується", async () => {
    const { apt, uid } = await resident("106", "Лисенко");
    await record(uid);
    await expectDbError(db.as(admin, `select public.admin_erase_apartment_personal_data($1, '')`, [apt]), /Вкажіть підставу/);
    await db.as(admin, `select public.admin_erase_apartment_personal_data($1, 'Заява Лисенко від 07.11.2026')`, [apt]);
    const notes = await db.sql(`select note from personal_data_consents where apartment_id = $1 and event = 'withdrawn'`, [apt]);
    expect(notes.rows[0]!.note).not.toMatch(/Лисенко/i);
    // мешканцю не можна викликати адміністративну функцію
    const other = await resident("107", "Савченко");
    await expectDbError(db.as(other.uid, `select public.admin_erase_apartment_personal_data($1, 'xxx')`, [apt]), /лише адміністратору/);
  });

  it("ім'я необов'язкове; мешканець сам вказує, змінює й видаляє його, але не номер квартири", async () => {
    const { apt, uid } = await resident("108", "Гнатюк");
    await db.as(admin, `select public.admin_upsert_apartment($1, '108', '', true, 0, null, null)`, [apt]);
    expect((await db.sql(`select resident_surname from apartments where id = $1`, [apt])).rows[0]!.resident_surname).toBeNull();
    await db.as(uid, `select public.resident_set_my_name('  Олена   Гнатюк ')`);
    expect((await db.sql(`select resident_surname from apartments where id = $1`, [apt])).rows[0]!.resident_surname).toBe("Олена Гнатюк");
    expect((await db.sql(`select surname from profiles where auth_user_id = $1`, [uid])).rows[0]!.surname).toBe("Олена Гнатюк");
    await db.as(uid, `select public.resident_set_my_name('')`);
    expect((await db.sql(`select resident_surname from apartments where id = $1`, [apt])).rows[0]!.resident_surname).toBeNull();
    // номер квартири мешканець змінити не може (адміністративна функція)
    await expectDbError(db.as(uid, `select public.admin_upsert_apartment($1, '999', null, true, 0, null, null)`, [apt]), /лише адміністратору/);
    await expectDbError(db.as(admin, `select public.resident_set_my_name('X')`), /лише її мешканець/);
  });

  it("адміністратор не може «самовидалитися» функцією мешканця", async () => {
    await expectDbError(db.as(admin, `select public.resident_erase_my_personal_data()`), /Адміністратор не може/);
  });
});

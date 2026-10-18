import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";
import { apartmentLoginEmail } from "../../src/lib/access-code";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
});
afterAll(async () => db?.destroy());

async function lookup(number: string): Promise<string | null> {
  return (await db.asService<{ e: string | null }>(`select public.system_login_email_for_apartment($1) as e`, [number])).rows[0]!.e;
}

async function issue(aptId: string): Promise<string> {
  // так робить сервер: шукає наявний запис квартири або створює новий у Auth
  const existing = (await db.as<{ id: string | null }>(admin, `select public.admin_apartment_account($1) as id`, [aptId])).rows[0]!.id;
  const uid = existing ?? (await db.createAuthUser(apartmentLoginEmail(aptId)));
  await db.as(admin, `select public.admin_register_access_code($1, $2)`, [aptId, uid]);
  return uid;
}

describe("Вхід за номером квартири та кодом доступу", () => {
  it("видача коду створює профіль мешканця квартири, без пошти й реєстрації", async () => {
    const apt = await db.createApartment(admin, "5", "Коваленко");
    expect(await lookup("5")).toBeNull();

    const uid = await issue(apt);
    const p = await db.sql(`select role, apartment_id, surname, is_primary, is_active from profiles where auth_user_id = $1`, [uid]);
    expect(p.rows[0]).toEqual({ role: "resident", apartment_id: apt, surname: "Коваленко", is_primary: true, is_active: true });
    const a = await db.sql(`select registration_status, registration_code_created_at is not null as has_date from apartments where id = $1`, [apt]);
    expect(a.rows[0]).toEqual({ registration_status: "registered", has_date: true });

    // номер квартири без урахування пробілів і регістру
    expect(await lookup(" 5 ")).toBe(apartmentLoginEmail(apt));

    const log = await db.sql(`select actor_user_id, new_values from audit_logs where action_type = 'apartment.access_code_set'`);
    expect(log.rows[0]!.actor_user_id).toBe(admin);
    expect(JSON.stringify(log.rows[0]!.new_values)).not.toMatch(/code"/);
  });

  it("зміна коду повторно використовує той самий обліковий запис", async () => {
    const apt = await db.createApartment(admin, "6", "Шевчук");
    const uid1 = await issue(apt);
    const uid2 = await issue(apt);
    expect(uid2).toBe(uid1);
    const cnt = await db.sql(`select count(*)::int c from profiles where apartment_id = $1`, [apt]);
    expect(cnt.rows[0]!.c).toBe(1);
    // чужий обліковий запис до квартири з доступом не прив'язати
    const other = await db.createAuthUser();
    await expectDbError(db.as(admin, `select public.admin_register_access_code($1, $2)`, [apt, other]), /інший обліковий запис/);
  });

  it("мешканець, зареєстрований раніше з поштою, входить тим самим записом", async () => {
    const apt = await db.createApartment(admin, "7", "Бондар");
    const legacy = await db.registerResident(admin, apt, "Бондар");
    const uid = await issue(apt);
    expect(uid).toBe(legacy);
    expect(await lookup("7")).toMatch(/@example\.test$/);
  });

  it("деактивований мешканець або квартира не можуть увійти; новий код відновлює доступ", async () => {
    const apt = await db.createApartment(admin, "8", "Мороз");
    const uid = await issue(apt);
    const pid = (await db.sql(`select id from profiles where auth_user_id = $1`, [uid])).rows[0]!.id;
    await db.as(admin, `select public.admin_set_profile_active($1, false, 'Виїхав')`, [pid]);
    expect(await lookup("8")).toBeNull();

    expect(await issue(apt)).toBe(uid);
    expect((await db.sql(`select is_active from profiles where id = $1`, [pid])).rows[0]!.is_active).toBe(true);
    expect(await lookup("8")).not.toBeNull();

    await db.as(admin, `select public.admin_upsert_apartment($1, '8', 'Мороз', false, null, null, 'Квартира продана')`, [apt]);
    expect(await lookup("8")).toBeNull();
    await expectDbError(db.as(admin, `select public.admin_register_access_code($1, $2)`, [apt, uid]), /неактивна/);
  });

  it("адміністраторський запис не можна прив'язати до квартири", async () => {
    const apt = await db.createApartment(admin, "9", "Лисенко");
    await expectDbError(db.as(admin, `select public.admin_register_access_code($1, $2)`, [apt, admin]), /адміністраторським/);
  });

  it("права: пошук для входу — лише сервер; видача коду — лише адміністратор", async () => {
    const apt = await db.createApartment(admin, "10", "Гнатюк");
    const resident = await issue(apt);
    await expectDbError(db.as(resident, `select public.system_login_email_for_apartment('10')`), /permission denied/);
    await expectDbError(db.asAnon(`select public.system_login_email_for_apartment('10')`), /permission denied/);
    await expectDbError(db.as(resident, `select public.admin_register_access_code($1, $2)`, [apt, resident]), /лише адміністратору/);
    await expectDbError(db.as(resident, `select public.admin_apartment_account($1)`, [apt]), /лише адміністратору/);
  });
});

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

describe("Контроль доступу та журнал змін", () => {
  it("6. мешканець не може змінювати чужі дані ні напряму, ні через функції", async () => {
    const a = await db.createApartment(admin, "31", "Остапенко", "0");
    const b = await db.createApartment(admin, "32", "Приходько", "0");
    const ua = await db.registerResident(admin, a, "Остапенко");
    await db.registerResident(admin, b, "Приходько");

    await expectDbError(db.submitReading(ua, b, period, "100"), /Немає доступу/);
    for (const stmt of [
      `insert into meter_readings (apartment_id, billing_period_id, previous_reading, current_reading, tariff_rate, electricity_amount, entered_by, entry_source) values ('${b}', '${period}', 0, 1, 1, 1, '${ua}', 'resident')`,
      `update meter_readings set current_reading = 0`,
      `update additional_charges set amount = 0`,
      `update payments set status = 'paid'`,
      `delete from payments`,
      `update apartments set resident_surname = 'X'`,
      `insert into tariffs (rate_per_kwh, valid_from) values (0.01, now())`,
      `update app_settings set envelope_url = 'https://evil.example'`,
      `insert into common_meter_readings (billing_period_id, previous_reading, current_reading, entered_by) values ('${period}', 0, 1, '${ua}')`,
      `insert into audit_logs (action_type, entity_type) values ('x', 'y')`,
      `update billing_periods set status = 'open'`,
    ]) {
      await expectDbError(db.as(ua, stmt), /permission denied/);
    }
    // адміністративні функції недоступні мешканцю
    for (const fn of [
      `select public.admin_set_tariff(0.01, current_date + 1, null)`,
      `select public.admin_close_period('${period}', null)`,
      `select public.admin_update_settings('{"envelope_url": "https://x.example"}'::jsonb, null)`,
      `select public.admin_list_users()`,
      `select public.admin_generate_registration_code('${b}', true)`,
      `select public.reject_payment('${period}', 'test')`,
    ]) {
      await expectDbError(db.as(ua, fn), /лише адміністратору/);
    }
    // мешканець бачить лише свій профіль
    const profiles = await db.as(ua, `select auth_user_id from profiles`);
    expect(profiles.rows).toEqual([{ auth_user_id: ua }]);
    // журнал змін недоступний мешканцю
    expect((await db.as(ua, `select * from audit_logs`)).rowCount).toBe(0);
  });

  it("Анонімний користувач не має доступу до жодних даних", async () => {
    for (const t of ["apartments", "payments", "meter_readings", "profiles", "deposit_ledger", "app_settings"]) {
      await expectDbError(db.asAnon(`select * from ${t}`), /permission denied/);
    }
    await expectDbError(db.asAnon(`select public.get_current_period()`), /permission denied/);
  });

  it("Деактивований мешканець втрачає доступ до змін", async () => {
    const a = await db.createApartment(admin, "33", "Дорошенко", "0");
    const ua = await db.registerResident(admin, a, "Дорошенко");
    const pid = (await db.sql(`select id from profiles where auth_user_id = $1`, [ua])).rows[0]!.id;
    await db.as(admin, `select public.admin_set_profile_active($1, false, 'Виїхав')`, [pid]);
    await expectDbError(db.submitReading(ua, a, period, "10"), /деактивовано/);
    const apt = await db.sql(`select registration_status from apartments where id = $1`, [a]);
    expect(apt.rows[0]!.registration_status).toBe("not_registered");
  });

  it("Захист останнього адміністратора", async () => {
    const pid = (await db.sql(`select id from profiles where auth_user_id = $1`, [admin])).rows[0]!.id;
    await expectDbError(db.as(admin, `select public.admin_set_profile_active($1, false, 'x')`, [pid]), /власний/);
    await expectDbError(db.as(admin, `select public.admin_set_profile_role($1, 'resident', 'x')`, [pid]), /останнього адміністратора/);
  });

  it("29. адміністративні зміни журналюються з автором, попередніми й новими значеннями", async () => {
    const a = await db.createApartment(admin, "34", "Семенюк", "0");
    await db.as(admin, `select public.admin_upsert_apartment($1, '34', 'Семенюк-Іванова', true, 0, null, 'Зміна прізвища')`, [a]);
    await db.as(admin, `select public.admin_update_settings('{"envelope_url": "https://send.monobank.ua/jar/example"}'::jsonb, 'Новий конверт')`);
    await db.submitReading(admin, a, period, "50");

    const logs = await db.as(admin, `select action_type, actor_user_id, actor_role, reason, previous_values, new_values
                                        from audit_logs order by created_at`);
    const upd = logs.rows.find((l) => l.action_type === "apartment.update")!;
    expect(upd).toMatchObject({ actor_user_id: admin, actor_role: "admin", reason: "Зміна прізвища" });
    expect(upd.previous_values.resident_surname).toBe("Семенюк");
    expect(upd.new_values.resident_surname).toBe("Семенюк-Іванова");
    expect(JSON.stringify(upd)).not.toContain("registration_code_hash");

    const st = logs.rows.find((l) => l.action_type === "settings.update" && l.reason === "Новий конверт")!;
    expect(st.new_values.envelope_url).toBe("https://send.monobank.ua/jar/example");

    const rd = logs.rows.find((l) => l.action_type === "reading.create" && l.new_values.apartment_id === a)!;
    expect(rd).toMatchObject({ actor_user_id: admin });
    expect(rd.new_values.entry_source).toBe("admin");

    // журнал не редагується
    await expectDbError(db.sql(`delete from audit_logs`), /не можна змінювати/);
    // некоректне посилання на конверт відхиляється
    await expectDbError(db.as(admin, `select public.admin_update_settings('{"envelope_url": "http://insecure.example"}'::jsonb, null)`), /неприпустиме/);
    await expectDbError(db.as(admin, `select public.admin_update_settings('{"role": "x"}'::jsonb, null)`), /Невідомий параметр/);
  });

  it("Імпорт квартир і масова генерація кодів", async () => {
    const r = await db.as<{ r: { created: number; updated: number } }>(admin,
      `select public.admin_import_apartments($1::jsonb) as r`,
      [JSON.stringify([{ apartment_number: "101", resident_surname: "Абрамчук" }, { apartment_number: "102", resident_surname: "Бабенко", initial_reading: "345.6" }, { apartment_number: "31", resident_surname: "Остапенко" }])]);
    expect(r.rows[0]!.r).toEqual({ created: 2, updated: 1 });
    const codes = await db.as(admin, `select * from public.admin_generate_codes_bulk()`);
    const nums = codes.rows.map((c) => c.apartment_number);
    expect(nums).toContain("101");
    expect(nums).not.toContain("31"); // уже зареєстрована
    expect(codes.rows.every((c) => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c.code))).toBe(true);
  });
});

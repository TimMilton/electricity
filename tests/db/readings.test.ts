import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectDbError } from "./helpers";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.3200");
});
afterAll(async () => db?.destroy());

describe("Періоди та вікно подання показників", () => {
  it("7–8. показники приймаються лише у відкрите вікно; повідомлення містить дати", async () => {
    const apt = await db.createApartment(admin, "1", "Петренко", "1000");
    const res = await db.registerResident(admin, apt, "Петренко");

    const future = (await db.as<{ id: string; status: string }>(admin,
      `select id, status from public.admin_create_period(2027, 1, now() + interval '2 days', now() + interval '5 days', true)`)).rows[0]!;
    expect(future.status).toBe("scheduled");
    await expectDbError(db.submitReading(res, apt, future.id, "1100"), /ще не розпочалося\. Період відкриється \d{2}\.\d{2}\.\d{4}/);

    const past = (await db.as<{ id: string }>(admin,
      `select id from public.admin_create_period(2026, 1, now() - interval '5 days', now() - interval '1 day', true)`)).rows[0]!;
    await expectDbError(db.submitReading(res, apt, past.id, "1100"), /завершився \d{2}\.\d{2}\.\d{4}.*Зверніться до адміністратора/);
    const st = await db.sql(`select status, closed_at from billing_periods where id = $1`, [past.id]);
    expect(st.rows[0]!.status).toBe("closed");

    const open = await db.openPeriod(admin, 2026, 2);
    const st2 = await db.as<{ status: string }>(res, `select status from billing_periods where id = $1`, [open]);
    expect(st2.rows[0]!.status).toBe("open");
    const r = await db.submitReading(res, apt, open, "1100");
    expect(r.reading.consumption_kwh).toBe(100);

    // адміністратор закриває період — мешканець більше не може змінювати
    await db.as(admin, `select public.admin_close_period($1, 'кінець місяця')`, [open]);
    await expectDbError(db.submitReading(res, apt, open, "1120"), /завершився/);
    // адміністратор може виправити після закриття (з причиною), дія журналюється
    await db.submitReading(admin, apt, open, "1120", { reason: "Помилка введення" });
    const log = await db.sql(`select actor_user_id, reason from audit_logs where action_type = 'reading.update' and entity_type = 'meter_reading'`);
    expect(log.rows.at(-1)).toMatchObject({ actor_user_id: admin, reason: "Помилка введення" });

    // повторне відкриття вимагає причини
    await expectDbError(db.as(admin, `select public.admin_reopen_period($1, now() + interval '1 day', '')`, [open]), /причину/);
    await db.as(admin, `select public.admin_reopen_period($1, now() + interval '1 day', 'Продовження за проханням')`, [open]);
    await db.submitReading(res, apt, open, "1125");

    // заборона адміністративних змін після закриття, якщо період так налаштовано
    const strict = (await db.as<{ id: string }>(admin,
      `select id from public.admin_create_period(2025, 12, now() - interval '5 days', now() - interval '1 day', false)`)).rows[0]!;
    await expectDbError(db.submitReading(admin, apt, strict.id, "1000", { previous: "900" }), /без можливості адміністративного/);
  });

  it("Для одного місяця — лише один період", async () => {
    await db.openPeriod(admin, 2030, 3);
    await expectDbError(db.openPeriod(admin, 2030, 3), /уже існує/);
  });
});

describe("Розрахунок показників і нарахувань", () => {
  it("9. попередній показник підставляється з останнього фактичного, навіть якщо місяць пропущено", async () => {
    const apt = await db.createApartment(admin, "2", "Коваль", "5000");
    const res = await db.registerResident(admin, apt, "Коваль");
    const p3 = await db.openPeriod(admin, 2026, 3);
    const p4 = await db.openPeriod(admin, 2026, 4); // мешканець пропустить
    const p5 = await db.openPeriod(admin, 2026, 5);

    const prev3 = await db.as(res, `select * from public.get_previous_reading($1, $2)`, [apt, p3]);
    expect(prev3.rows[0]).toMatchObject({ previous_reading: "5000.00", source: "initial" });

    await db.submitReading(res, apt, p3, "5150");
    // мешканець намагається підмінити попередній показник — ігнорується
    const r5 = await db.submitReading(res, apt, p5, "5300", { previous: "0" });
    expect(r5.reading.previous_reading).toBe(5150);
    expect(r5.reading.consumption_kwh).toBe(150);
    void p4;
  });

  it("9. перше подання без історії вимагає вказати початковий показник", async () => {
    const apt = await db.createApartment(admin, "3", "Савченко");
    const res = await db.registerResident(admin, apt, "Савченко");
    const p = await db.openPeriod(admin, 2026, 6);
    await expectDbError(db.submitReading(res, apt, p, "200"), /Не знайдено попереднього показника/);
    const r = await db.submitReading(res, apt, p, "200", { previous: "150" });
    expect(r.reading.consumption_kwh).toBe(50);
    expect(r.warnings.join(" ")).toMatch(/вручну/);
  });

  it("10–12. споживання, сума за тарифом і загальна сума з внесками рахуються точно", async () => {
    const apt = await db.createApartment(admin, "4", "Гончар", "12345.67");
    const res = await db.registerResident(admin, apt, "Гончар");
    const p = await db.openPeriod(admin, 2026, 7);
    const r = await db.submitReading(res, apt, p, "12478.12", { deposit: "50.00", hall: "15.5" });
    // K = 132.45; E = 132.45 × 4.32 = 572.184 → 572.18
    expect(r.reading.consumption_kwh).toBe(132.45);
    expect(r.reading.tariff_rate).toBe(4.32);
    expect(r.reading.electricity_amount).toBe(572.18);
    expect(r.payment).toMatchObject({
      electricity_amount: 572.18, deposit_contribution: 50, hall_lighting_amount: 15.5, other_amount: 0,
      total_amount: 637.68, status: "awaiting_payment",
    });
    const charges = await db.sql(`select charge_type, amount from additional_charges where apartment_id = $1 and billing_period_id = $2 order by charge_type`, [apt, p]);
    expect(charges.rows).toEqual([
      { charge_type: "deposit_contribution", amount: "50.00" },
      { charge_type: "hall_lighting", amount: "15.50" },
      { charge_type: "other", amount: "0.00" },
    ]);
    // повторне подання в межах вікна оновлює ту саму пару квартира+період
    const r2 = await db.submitReading(res, apt, p, "12478.12", { deposit: "0", hall: "0" });
    expect(r2.payment.total_amount).toBe(572.18);
    const cnt = await db.sql(`select count(*)::int c from meter_readings where apartment_id = $1 and billing_period_id = $2`, [apt, p]);
    expect(cnt.rows[0]!.c).toBe(1);
  });

  it("Валідація: менший показник, від'ємні суми, зайва точність, ліміт, інші внески", async () => {
    const apt = await db.createApartment(admin, "5", "Бойко", "100");
    const res = await db.registerResident(admin, apt, "Бойко");
    const p = await db.openPeriod(admin, 2026, 8);
    await expectDbError(db.submitReading(res, apt, p, "99"), /менший за попередній.*зверніться до адміністратора/);
    await expectDbError(db.submitReading(res, apt, p, "150", { deposit: "-1" }), /від'ємними/);
    await expectDbError(db.submitReading(res, apt, p, "150", { deposit: "1.005" }), /копійок/);
    await expectDbError(db.submitReading(res, apt, p, "150", { hall: "10001" }), /не може перевищувати/);
    await expectDbError(db.submitReading(res, apt, p, "150", { other: "5" }), /не приймаються/);
    // нульові внески дозволені
    const ok = await db.submitReading(res, apt, p, "150", { deposit: "0", hall: "0" });
    expect(ok.payment.total_amount).toBe(216);
    // інші внески — лише за налаштуванням адміністратора
    await db.as(admin, `select public.admin_update_settings('{"other_charges_enabled": true}'::jsonb, null)`);
    const ok2 = await db.submitReading(res, apt, p, "150", { other: "5" });
    expect(ok2.payment.other_amount).toBe(5);
    await db.as(admin, `select public.admin_update_settings('{"other_charges_enabled": false}'::jsonb, null)`);
  });

  it("Попередження про аномальне споживання не відхиляє показник", async () => {
    await db.as(admin, `select public.admin_update_settings('{"anomaly_threshold_kwh": 500}'::jsonb, null)`);
    const apt = await db.createApartment(admin, "6", "Руденко", "0");
    const res = await db.registerResident(admin, apt, "Руденко");
    const p = await db.openPeriod(admin, 2026, 10);
    const r = await db.submitReading(res, apt, p, "900");
    expect(r.reading.is_anomaly).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/Аномально високе/);
    await db.as(admin, `select public.admin_update_settings('{"anomaly_threshold_kwh": ""}'::jsonb, null)`);
  });

  it("26. зміна тарифу не змінює історичних нарахувань; новий тариф діє лише з дати", async () => {
    const apt = await db.createApartment(admin, "7", "Литвин", "0");
    const res = await db.registerResident(admin, apt, "Литвин");
    const p = await db.openPeriod(admin, 2026, 11);
    const before = await db.submitReading(res, apt, p, "100");
    expect(before.reading.electricity_amount).toBe(432);

    await db.setTariff(admin, "5.0000", "2026-12-01");
    // старий тариф отримав дату завершення
    const t = await db.sql(`select rate_per_kwh, valid_from::text, valid_until::text from tariffs order by valid_from`);
    expect(t.rows).toEqual([
      { rate_per_kwh: "4.3200", valid_from: "2020-01-01", valid_until: "2026-11-30" },
      { rate_per_kwh: "5.0000", valid_from: "2026-12-01", valid_until: null },
    ]);
    // старий рядок не змінився
    const old = await db.sql(`select tariff_rate, electricity_amount from meter_readings where id = $1`, [before.reading.id]);
    expect(old.rows[0]).toEqual({ tariff_rate: "4.3200", electricity_amount: "432.00" });
    // повторне редагування того ж місяця зберігає зафіксований тариф
    const again = await db.submitReading(res, apt, p, "110");
    expect(again.reading.tariff_rate).toBe(4.32);
    // новий місяць — новий тариф
    const pDec = await db.openPeriod(admin, 2026, 12);
    const dec = await db.submitReading(res, apt, pDec, "210");
    expect(dec.reading).toMatchObject({ tariff_rate: 5, electricity_amount: 500 });
    // тариф з більш ранньою датою додати не можна
    await expectDbError(db.setTariff(admin, "6", "2026-06-01"), /пізнішою датою/);
  });

  it("27. історія зберігається після переходу до нового місяця; внески минулого місяця незмінні", async () => {
    const apt = await db.createApartment(admin, "8", "Мороз", "0");
    const res = await db.registerResident(admin, apt, "Мороз");
    const pA = await db.openPeriod(admin, 2027, 3);
    await db.submitReading(res, apt, pA, "100", { deposit: "30", hall: "10" });
    await db.as(admin, `select public.admin_close_period($1, null)`, [pA]);
    const pB = await db.openPeriod(admin, 2027, 4);
    await db.submitReading(res, apt, pB, "180", { deposit: "0", hall: "20" });
    const hist = await db.as(res, `
      select p.month, r.previous_reading, r.current_reading,
             (select amount from additional_charges c where c.apartment_id = r.apartment_id and c.billing_period_id = r.billing_period_id and c.charge_type = 'deposit_contribution') dep
        from meter_readings r join billing_periods p on p.id = r.billing_period_id
       where r.apartment_id = $1 and p.year = 2027 order by p.month`, [apt]);
    expect(hist.rows).toEqual([
      { month: 3, previous_reading: "0.00", current_reading: "100.00", dep: "30.00" },
      { month: 4, previous_reading: "100.00", current_reading: "180.00", dep: "0.00" },
    ]);
  });

  it("Виправлення старого показника, що впливає на наступні місяці, вимагає підтвердження", async () => {
    const apt = await db.createApartment(admin, "9", "Ткач", "0");
    const res = await db.registerResident(admin, apt, "Ткач");
    const pA = await db.openPeriod(admin, 2028, 1);
    const pB = await db.openPeriod(admin, 2028, 2);
    await db.submitReading(res, apt, pA, "100");
    await db.submitReading(res, apt, pB, "200");
    await expectDbError(db.submitReading(admin, apt, pA, "110", { reason: "Уточнення" }), /впливає на 1/, "EO409");
    const r = await db.submitReading(admin, apt, pA, "110", { reason: "Уточнення", ack: true });
    expect(r.warnings.join(" ")).toMatch(/наступн/);
    // наступний місяць не перераховано непомітно
    const b = await db.sql(`select previous_reading from meter_readings where apartment_id = $1 and billing_period_id = $2`, [apt, pB]);
    expect(b.rows[0]!.previous_reading).toBe("100.00");
    // без причини адміністратор не може змінити наявний запис
    await expectDbError(db.submitReading(admin, apt, pB, "210"), /вкажіть причину/);
  });

  it("Без тарифу розрахунок неможливий", async () => {
    const db2 = await TestDb.create();
    try {
      const a = await db2.createAdmin();
      const apt = await db2.createApartment(a, "1", "Тест", "0");
      const p = await db2.openPeriod(a, 2026, 9);
      await expectDbError(db2.submitReading(a, apt, p, "10"), /Тариф для цього періоду не визначено/);
    } finally {
      await db2.destroy();
    }
  });
});

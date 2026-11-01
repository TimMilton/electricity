import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";
import { calculateCharge, toDecimalString } from "@/lib/money";

/*
  Сума, яку мешканець бачить у формі до надсилання (розрахунок у браузері),
  має збігатися з тим, що зберігає сервер у показнику й платежі,
  і з тим, що показують загальна таблиця та сторінка оплати.
*/

let db: TestDb;
let admin: string;

// Детермінований генератор, щоб тест був відтворюваним
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
});
afterAll(async () => db?.destroy());

describe("Узгодженість розрахунку браузер ↔ сервер", () => {
  it("споживання, сума за електроенергію й загальна сума збігаються до копійки", async () => {
    const rand = rng(20261101);
    // Тарифи з 4 знаками, що дають «половинки» копійок
    const tariffs = ["4.3200", "2.6400", "7.9999", "3.0125", "1.6805"];
    let month = 1;
    for (const [ti, tariff] of tariffs.entries()) {
      await db.setTariff(admin, tariff, `${2030 + ti}-01-01`);
      for (let i = 0; i < 8; i++) {
        const prev = (Math.floor(rand() * 9_000_000) / 100).toFixed(2);
        const cur = (Number(prev) + Math.floor(rand() * 200_000) / 100).toFixed(2);
        const deposit = (Math.floor(rand() * 50_000) / 100).toFixed(2);
        const hall = (Math.floor(rand() * 10_000) / 100).toFixed(2);

        const apt = await db.createApartment(admin, `${ti}-${i}`, "Тест", prev);
        const uid = await db.registerResident(admin, apt, "Тест");
        const period =
          (await db.sql(`select id from billing_periods where year = $1 and month = $2`, [2030 + ti, (i % 12) + 1])).rows[0]?.id ??
          (await db.openPeriod(admin, 2030 + ti, (i % 12) + 1));
        month++;

        const client = calculateCharge({ previous: prev, current: cur, tariff, deposit, hallLighting: hall, other: "0" });
        expect(client.ok).toBe(true);
        if (!client.ok) continue;

        await db.submitReading(uid, apt, period as string, cur, { deposit, hall });
        const server = (
          await db.sql(
            `select r.consumption_kwh::text k, r.electricity_amount::text e, p.electricity_amount::text pe,
                    p.deposit_contribution::text d, p.hall_lighting_amount::text h, p.total_amount::text t
               from meter_readings r join payments p using (apartment_id, billing_period_id)
              where r.apartment_id = $1 and r.billing_period_id = $2`,
            [apt, period],
          )
        ).rows[0]!;
        const label = `${prev} → ${cur} × ${tariff} + ${deposit} + ${hall}`;
        expect(server.k, label).toBe(toDecimalString(client.value.consumption, 2));
        expect(server.e, label).toBe(toDecimalString(client.value.electricity, 2));
        expect(server.pe, label).toBe(server.e);
        expect(server.d, label).toBe(toDecimalString(client.value.deposit, 2));
        expect(server.h, label).toBe(toDecimalString(client.value.hallLighting, 2));
        expect(server.t, label).toBe(toDecimalString(client.value.total, 2));

        // загальна таблиця місяця показує ті самі суми
        const row = (
          await db.as<{ electricity_amount: string; total_amount: string }>(
            uid,
            `select electricity_amount::text, total_amount::text from public.get_period_table($1) where apartment_id = $2`,
            [period, apt],
          )
        ).rows[0]!;
        expect(row).toEqual({ electricity_amount: server.e, total_amount: server.t });
      }
    }
    expect(month).toBeGreaterThan(1);
  });
});

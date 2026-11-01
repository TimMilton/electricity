/* eslint-disable @typescript-eslint/no-explicit-any -- довільна структура JSON-відповіді в тестах */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createAdmin();
  await db.setTariff(admin, "4.32");
});
afterAll(async () => db?.destroy());

describe("Суми депозиту, які бачать мешканці", () => {
  it("баланс, загальні внески і зведення будинку враховують і внески з показниками, і окремі", async () => {
    await db.sql(`update app_settings set show_deposit_balance_to_residents = true`);
    const a1 = await db.createApartment(admin, "1", "Перша", "1000");
    const a2 = await db.createApartment(admin, "2", "Друга", "2000");
    const u1 = await db.registerResident(admin, a1, "Перша");
    const u2 = await db.registerResident(admin, a2, "Друга");
    const p = await db.openPeriod(admin, 2026, 10);

    await db.submitReading(u1, a1, p, "1100", { deposit: "50" });
    const pay = (await db.paymentFor(a1, p))!;
    await db.as(u1, `select public.submit_payment_for_review($1, $2::jsonb)`, [pay.id, db.receiptJson(a1, pay.id!)]);
    await db.as(admin, `select public.approve_payment($1, null)`, [pay.id]);

    const topup = async (uid: string, apt: string, amount: string) =>
      (await db.as<{ id: string }>(uid, `select (public.submit_deposit_topup($1, $2::numeric, $3::jsonb, null)).id`, [
        apt, amount,
        JSON.stringify([{ storage_path: `topup/${apt}/${randomUUID()}.pdf`, original_filename: "r.pdf", mime_type: "application/pdf", file_size: 100 }]),
      ])).rows[0]!.id;
    const t1 = await topup(u1, a1, "150");
    await topup(u2, a2, "30"); // ще на перевірці
    await db.as(admin, `select public.admin_approve_deposit_topup($1, null)`, [t1]);

    // будь-який мешканець бачить однаковий коректний баланс
    for (const uid of [u1, u2]) {
      const d = (await db.as<{ d: any }>(uid, `select public.get_deposit_summary() d`)).rows[0]!.d;
      expect(d).toMatchObject({ is_public: true, balance: 200, total_contributions: 200 });
      const s = (await db.as<{ s: any }>(uid, `select public.get_house_summary($1) s`, [p])).rows[0]!.s;
      expect(s).toMatchObject({ deposit_balance: 200, charged_deposit: 50, topups_paid: 150, topups_pending: 30 });
    }
  });
});

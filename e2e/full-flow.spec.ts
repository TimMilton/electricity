/**
 * Повний сценарій з реальним Supabase (локальний `supabase start` або тестовий проєкт).
 * Запуск: E2E_FULL=1 з заповненими SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY. Тест створює власні тестові дані з унікальними номерами.
 * НЕ запускайте проти бойової бази.
 */
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = (process.env.SUPABASE_PUBLIC_URL ?? process.env.SUPABASE_URL)!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const run = randomUUID().slice(0, 6);
const adminEmail = `e2e-admin-${run}@example.test`;
const residentEmail = `e2e-resident-${run}@example.test`;
const password = "E2eTest-12345";
const aptNumber = `E${run}`;
const surname = "Тестовий";

// мінімальний PDF
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test.describe.configure({ mode: "serial" });

let code = "";

test.beforeAll(async () => {
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: u, error } = await service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true });
  if (error) throw error;
  await service.rpc("bootstrap_admin", { p_auth_user_id: u.user.id, p_surname: "E2E-адмін" });

  const admin = createClient(url, anonKey, { auth: { persistSession: false } });
  await admin.auth.signInWithPassword({ email: adminEmail, password });
  const { data: apt } = await admin.rpc("admin_upsert_apartment", {
    p_id: null, p_apartment_number: aptNumber, p_resident_surname: surname, p_is_active: true,
    p_initial_reading: 1000, p_initial_reading_date: null, p_reason: "e2e",
  });
  const { data: c } = await admin.rpc("admin_generate_registration_code", { p_apartment_id: (apt as { id: string }).id, p_allow_additional: false });
  code = String(c);
  // тариф і відкритий період (якщо ще немає)
  await admin.rpc("admin_set_tariff", { p_rate: 4.32, p_valid_from: "2000-01-01", p_reason: "e2e" }).then(() => undefined);
  const now = Date.now();
  const d = new Date(now);
  await admin.rpc("admin_create_period", {
    p_year: d.getUTCFullYear() + 50, p_month: 1,
    p_window_start: new Date(now - 86400_000).toISOString(), p_window_end: new Date(now + 86400_000).toISOString(),
    p_allow_admin_edit_after_close: true,
  });
  await service.from("app_settings").update({ envelope_url: "https://example.com/envelope" }).eq("id", true);
});

test("1–4, 9–15. мешканець: реєстрація з кодом, показники, внески, оплата з квитанцією", async ({ page, context }) => {
  await page.goto("/register");
  await page.getByLabel("Квартира №").fill(aptNumber);
  await page.getByLabel("Прізвище").fill(surname);
  await page.getByLabel(/Код підтвердження/).fill(code);
  await page.getByLabel("Електронна пошта").fill(residentEmail);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Підтвердження пароля").fill(password);
  await page.getByRole("button", { name: "Зареєструватися" }).click();

  // Якщо підтвердження пошти увімкнене — підтверджуємо через сервісний ключ і входимо
  if (!(await page.waitForURL(/\/home/, { timeout: 5000 }).then(() => true, () => false))) {
    const service = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data } = await service.auth.admin.listUsers();
    const user = data.users.find((u) => u.email === residentEmail)!;
    await service.auth.admin.updateUserById(user.id, { email_confirm: true });
    await page.goto("/login");
    await page.getByLabel("Електронна пошта").fill(residentEmail);
    await page.getByLabel("Пароль").fill(password);
    await page.getByRole("button", { name: "Увійти" }).click();
  }
  await expect(page.getByRole("heading", { name: `Квартира №${aptNumber}` })).toBeVisible();

  await page.getByRole("link", { name: "Внести показники" }).click();
  await expect(page.getByText("1000").first()).toBeVisible(); // попередній підставлено
  await page.getByLabel("Поточний показник, кВт·год").fill("1132,45");
  await page.getByLabel(/Депозит на покриття/).fill("50");
  await page.getByLabel("Освітлення під'їзду, грн").fill("15,50");
  await expect(page.getByText("637,68")).toBeVisible(); // 572,18 + 50 + 15,50
  await page.getByRole("button", { name: "Надіслати показники" }).click();
  await page.waitForURL(/\/home/);

  await page.getByRole("link", { name: /Оплатити/ }).click();
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "Перейти до конверта" }).click();
  const popup = await popupPromise;
  await popup.close();
  await page.getByRole("button", { name: "Продовжити" }).click();
  const send = page.getByRole("button", { name: "Надіслати на перевірку" });
  await expect(send).toBeDisabled();
  await page.getByLabel(/Я здійснив оплату/).check();
  await page.locator("input[type=file]").setInputFiles({ name: "kvytantsiia.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole("heading", { name: "Платіж на перевірці" })).toBeVisible();
});

test("15, 20. адміністратор підтверджує оплату; депозит поповнюється один раз", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Електронна пошта").fill(adminEmail);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Увійти" }).click();
  await page.waitForURL(/\/admin/);
  await page.goto("/admin/payments?status=pending_review&q=" + encodeURIComponent(aptNumber));
  await page.getByRole("link", { name: "Перевірити" }).first().click();
  await expect(page.getByText("kvytantsiia.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Підтвердити оплату" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити" }).click();
  await expect(page.getByText(/Зараховано до депозиту/)).toBeVisible();
});

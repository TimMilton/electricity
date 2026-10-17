import { expect, test } from "@playwright/test";

test.describe("Публічні сторінки та захист маршрутів", () => {
  test("неавторизованого користувача перенаправляє на вхід зі збереженням адреси", async ({ page }) => {
    await page.goto("/admin/payments");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fpayments/);
    await expect(page.getByRole("heading", { name: "Вхід" })).toBeVisible();
  });

  test("захищені сторінки мешканця недоступні без входу", async ({ page }) => {
    for (const path of ["/home", "/readings", "/pay", "/residents", "/history", "/profile"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("експорт і cron недоступні без прав", async ({ request }) => {
    const exp = await request.get("/api/export/table", { maxRedirects: 0 });
    expect([302, 307, 403]).toContain(exp.status());
    const cron = await request.get("/api/cron/periods");
    expect([401, 503]).toContain(cron.status());
  });

  test("форма входу валідує дані до звернення до сервера автентифікації", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Електронна пошта").fill("не-пошта");
    await page.getByLabel("Пароль").fill("x");
    await page.getByRole("button", { name: "Увійти" }).click();
    await expect(page.getByText("Некоректна електронна пошта")).toBeVisible();
  });

  test("реєстрація: поля форми та перевірка пароля", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Реєстрація мешканця" })).toBeVisible();
    await page.getByLabel("Квартира №").fill("12");
    await page.getByLabel("Прізвище").fill("Петренко");
    await page.getByLabel(/Код підтвердження/).fill("ABCDE-12345");
    await page.getByLabel("Електронна пошта").fill("resident@example.com");
    await page.getByLabel("Пароль", { exact: true }).fill("password1");
    await page.getByLabel("Підтвердження пароля").fill("password2");
    await page.getByRole("button", { name: "Зареєструватися" }).click();
    await expect(page.getByText("Паролі не збігаються")).toBeVisible();
    await expect(page.getByText(/зверніться до адміністратора/i)).toBeVisible();
  });

  test("відновлення пароля", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Забули пароль?" }).click();
    await expect(page.getByRole("heading", { name: "Відновлення пароля" })).toBeVisible();
  });

  test("30. сторінки адаптуються до смартфона без горизонтальної прокрутки", async ({ page }) => {
    for (const path of ["/login", "/register", "/forgot-password"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("безпечні заголовки відповіді", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-powered-by"]).toBeUndefined();
    // адреса Supabase для браузера береться зі змінних середовища під час запуску
    expect(h["content-security-policy"]).toContain("http://127.0.0.1:59999");
  });

  test("перевірка стану для Docker HEALTHCHECK", async ({ request }) => {
    const ok = await request.get("/api/health");
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const deep = await request.get("/api/health?deep=1");
    expect(deep.status()).toBe(503);
  });

  test("шаблони листів доступні без входу (їх читає сервіс Auth)", async ({ request }) => {
    const res = await request.get("/email-templates/confirmation.html", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("{{ .ConfirmationURL }}");
  });
});

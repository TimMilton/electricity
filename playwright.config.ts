import { defineConfig, devices } from "@playwright/test";

/**
 * Два набори e2e-тестів:
 *  - smoke   — інтерфейс без бекенду (публічні сторінки, редиректи, валідація, мобільна верстка);
 *  - full    — повні сценарії з реальним Supabase (потрібні E2E_FULL=1 і змінні з .env.e2e, див. README).
 *
 * PW_CHROMIUM_PATH — шлях до встановленого Chromium, якщо браузери Playwright не завантажено.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const full = process.env.E2E_FULL === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, locale: "uk-UA", timezoneId: "Europe/Kyiv", trace: "retain-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions }, testIgnore: full ? [] : /full-flow/ },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions }, testMatch: /smoke|mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `node .next/standalone/server.js`,
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 120_000,
        // standalone-сервер читає PORT/HOSTNAME зі змінних середовища
        env: full
          ? { PORT: String(port), HOSTNAME: "127.0.0.1" }
          : {
              PORT: String(port),
              HOSTNAME: "127.0.0.1",
              // Фіктивний бекенд: сторінки, що не потребують даних, працюють без мережі
              SUPABASE_URL: "http://127.0.0.1:59999",
              SUPABASE_ANON_KEY: "e2e-dummy-key",
            },
      },
});

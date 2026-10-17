#!/usr/bin/env node
/**
 * Створення першого адміністратора (одноразове початкове налаштування).
 * Без залежностей: працює і локально, і всередині Docker-контейнера застосунку.
 *
 *   Локально:  npm run create-admin -- --email admin@example.com --surname Прізвище
 *   Docker:    docker compose exec app node scripts/create-admin.mjs --email admin@example.com --surname Прізвище
 *
 * Пароль запитується інтерактивно (або береться з ADMIN_PASSWORD).
 * Потрібні SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY (у Docker вони вже задані;
 * локально — у .env.local). Сервісний ключ використовується лише тут, на сервері.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, env, exit } from "node:process";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // файлу немає — змінні можуть бути вже задані середовищем
  }
}

function arg(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function fail(message) {
  console.error(`Помилка: ${message}`);
  exit(1);
}

const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
const email = arg("email")?.trim().toLowerCase();
const surname = arg("surname")?.trim() || "Адміністратор";

if (!url || !key) fail("не задано SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("вкажіть коректну пошту: --email admin@example.com");

let password = env.ADMIN_PASSWORD;
if (!password) {
  if (!stdin.isTTY) fail("немає інтерактивного терміналу — задайте пароль через ADMIN_PASSWORD");
  const rl = createInterface({ input: stdin, output: stdout });
  password = await rl.question("Пароль адміністратора (мін. 8 символів, літери й цифри): ");
  rl.close();
}
if (!password || password.length < 8 || !/\d/.test(password) || !/\p{L}/u.test(password)) {
  fail("пароль надто простий: потрібно щонайменше 8 символів, літери й цифри");
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function call(method, path, body) {
  const res = await fetch(`${url}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function findUserId() {
  for (let page = 1; page <= 50; page++) {
    const r = await call("GET", `/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!r.ok) return null;
    const users = r.json?.users ?? [];
    const u = users.find((x) => x.email?.toLowerCase() === email);
    if (u) return u.id;
    if (users.length < 200) return null;
  }
  return null;
}

let userId;
const created = await call("POST", "/auth/v1/admin/users", { email, password, email_confirm: true });
if (created.ok) {
  userId = created.json.id;
} else {
  userId = await findUserId();
  if (!userId) {
    fail(`не вдалося створити користувача (${created.status}): ${created.json?.msg ?? created.json?.message ?? "невідома помилка"}`);
  }
  console.log("Користувач із цією поштою вже існує — надаємо йому роль адміністратора (пароль не змінено).");
}

const rpc = await call("POST", "/rest/v1/rpc/bootstrap_admin", { p_auth_user_id: userId, p_surname: surname });
if (!rpc.ok) {
  fail(`не вдалося призначити роль (${rpc.status}): ${rpc.json?.message ?? "перевірте, що міграції застосовано"}`);
}
console.log(`Готово: ${email} — адміністратор. Увійдіть у застосунок і відкрийте /admin.`);

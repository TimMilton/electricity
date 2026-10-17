#!/usr/bin/env node
/**
 * Створює файл .env для docker compose з надійними випадковими секретами.
 * Без залежностей (лише Node.js ≥ 18).
 *
 *   node docker/init-env.mjs                                  локально: http://localhost:8080
 *   node docker/init-env.mjs --port 9000                      локально на іншому порту
 *   node docker/init-env.mjs --domain elektro.example.com     сервер з HTTPS (Let's Encrypt)
 *   node docker/init-env.mjs --force                          перезаписати наявний .env
 *
 * Без встановленого Node:
 *   docker run --rm -v "$PWD:/w" -w /w node:22-alpine node docker/init-env.mjs
 *
 * УВАГА: --force на вже запущеній системі змінить паролі й ключі — після цього
 * наявна база не прийме нових паролів. Використовуйте лише для нового розгортання.
 */
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const force = argv.includes("--force");
const target = join(root, ".env");

if (existsSync(target) && !force) {
  console.error(".env уже існує. Щоб створити новий (нові секрети!), додайте --force.");
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** JWT HS256 для ролей Supabase (anon / service_role). */
export function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

const domain = arg("domain")?.trim().toLowerCase();
if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
  console.error("Некоректний домен. Приклад: --domain elektro.example.com");
  process.exit(1);
}
const port = Number(arg("port") ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Некоректний порт");
  process.exit(1);
}

const jwtSecret = randomBytes(32).toString("hex"); // 64 символи
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 10 * 365 * 24 * 3600; // 10 років — ключі ролей, не сесії користувачів

const values = {
  PUBLIC_URL: domain ? `https://${domain}` : port === 80 ? "http://localhost" : `http://localhost:${port}`,
  SITE_ADDRESS: domain ?? ":80",
  HTTP_PORT: domain ? "80" : String(port),
  HTTPS_PORT: domain ? "443" : "8443",
  POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  JWT_SECRET: jwtSecret,
  ANON_KEY: signJwt({ role: "anon", iss: "supabase", iat, exp }, jwtSecret),
  SERVICE_ROLE_KEY: signJwt({ role: "service_role", iss: "supabase", iat, exp }, jwtSecret),
  CRON_SECRET: randomBytes(32).toString("hex"),
};

const template = readFileSync(join(root, ".env.docker.example"), "utf8");
const lines = template.split(/\r?\n/).map((line) => {
  const m = /^([A-Z0-9_]+)=/.exec(line);
  if (m && m[1] in values) return `${m[1]}=${values[m[1]]}`;
  return line;
});
writeFileSync(target, lines.join("\n"), { mode: 0o600 });

console.log(`Створено .env
  Адреса застосунку:  ${values.PUBLIC_URL}
  Поштова скринька:   http://localhost:8025 (листи підтвердження, поки не налаштовано SMTP)

Далі:
  docker compose up -d --build
  docker compose exec app node scripts/create-admin.mjs --email you@example.com --surname Прізвище
${domain ? `\nПеред запуском спрямуйте DNS-запис ${domain} на цей сервер і відкрийте порти 80 та 443.\n` : ""}
Збережіть .env у надійному місці: без нього не відновити доступ до бази з резервної копії.`);

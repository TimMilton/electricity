/**
 * Коди доступу мешканців.
 *
 * Код видає адміністратор: 10 символів без схожих на вигляд (0/O, 1/I),
 * показується як «ABCDE-12345». Під час входу регістр, пробіли й дефіси
 * не важливі. Технічно нормалізований код — пароль облікового запису квартири.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 символи, без 0/O/1/I

export function generateAccessCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(10);
  let code = "";
  for (let i = 0; i < 10; i++) code += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Нормалізація для входу: лише літери й цифри, верхній регістр. */
export function normalizeAccessCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Технічна адреса облікового запису квартири. Листи на неї не надсилаються —
 * вона лише ідентифікує запис у Supabase Auth. Домен можна змінити змінною
 * RESIDENT_LOGIN_DOMAIN (на вхід уже виданих кодів це не впливає).
 */
export function apartmentLoginEmail(apartmentId: string): string {
  const domain = (process.env.RESIDENT_LOGIN_DOMAIN ?? "").trim() || "kvartyry.elektrooblik.local";
  return `apt-${apartmentId.toLowerCase()}@${domain}`;
}

import type { ActionResult } from "./types";

type DbError = { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined;

const GENERIC = "Не вдалося виконати дію. Спробуйте ще раз або зверніться до адміністратора";

/**
 * Перетворює помилку бази даних на повідомлення для користувача.
 * Показуються лише повідомлення бізнес-логіки (P0001 / EO409);
 * технічні подробиці не розкриваються.
 */
export function dbErrorToResult(error: DbError): Extract<ActionResult, { ok: false }> {
  if (!error) return { ok: false, error: GENERIC };
  if (error.code === "P0001" && error.message) return { ok: false, error: error.message };
  if (error.code === "EO409" && error.message) return { ok: false, error: error.message, needsConfirmation: true };
  if (error.code === "42501") return { ok: false, error: "Недостатньо прав для цієї дії" };
  if (error.code === "23505") return { ok: false, error: "Такий запис уже існує" };
  if (error.code === "23514") return { ok: false, error: "Дані не пройшли перевірку. Перевірте введені значення" };
  if (process.env.NODE_ENV !== "production") console.error("DB error", error);
  return { ok: false, error: GENERIC };
}

export function zodToResult(issues: { path: PropertyKey[]; message: string }[]): Extract<ActionResult, { ok: false }> {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".") || "_";
    if (!fieldErrors[key]) fieldErrors[key] = i.message;
  }
  return { ok: false, error: issues[0]?.message ?? "Перевірте введені дані", fieldErrors };
}

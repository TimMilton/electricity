import { describe, expect, it, vi } from "vitest";
import { dbErrorToResult } from "@/lib/errors";

describe("Повідомлення про помилки бази", () => {
  it("бізнес-помилки показуються як є, технічні — загальним текстом", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(dbErrorToResult({ code: "P0001", message: "Тариф не знайдено" }).error).toBe("Тариф не знайдено");
    expect(dbErrorToResult({ code: "EO409", message: "Підтвердьте" })).toMatchObject({ needsConfirmation: true });
    expect(dbErrorToResult({ code: "XX000", message: "internal" }).error).toMatch(/Не вдалося виконати дію/);
  });

  it("якщо база не оновлена (немає функції чи стовпчика) — підказка про міграції", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const code of ["PGRST202", "42883", "42703"]) {
      expect(dbErrorToResult({ code, message: "Could not find the function" }).error).toMatch(/База даних не оновлена.*supabase\/migrations/);
    }
  });
});

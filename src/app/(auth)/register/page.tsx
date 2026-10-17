import type { Metadata } from "next";
import { connection } from "next/server";
import { RegisterForm } from "@/components/auth-forms";
import { createServiceClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Реєстрація" };

async function registrationSettings(): Promise<{ open: boolean; codeRequired: boolean }> {
  try {
    const admin = createServiceClient();
    const { data } = await admin.from("app_settings").select("registration_open, registration_code_required").single();
    return { open: data?.registration_open ?? true, codeRequired: data?.registration_code_required ?? true };
  } catch {
    return { open: true, codeRequired: true };
  }
}

export default async function RegisterPage() {
  await connection(); // налаштування реєстрації читаються під час запиту
  const s = await registrationSettings();
  return (
    <div className="flex flex-col gap-6 pt-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Реєстрація мешканця</h1>
        <p className="mt-1 text-ink-soft">
          Вкажіть номер квартири, прізвище та код, який видав адміністратор. Одна квартира — один основний обліковий запис.
        </p>
      </div>
      {s.open ? (
        <RegisterForm codeRequired={s.codeRequired} />
      ) : (
        <p className="rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3">
          Самостійна реєстрація зараз закрита. Зверніться до адміністратора будинку.
        </p>
      )}
    </div>
  );
}

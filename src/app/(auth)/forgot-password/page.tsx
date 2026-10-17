import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Відновлення пароля" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Відновлення пароля</h1>
        <p className="mt-1 text-ink-soft">Надішлемо на пошту посилання для встановлення нового пароля.</p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}

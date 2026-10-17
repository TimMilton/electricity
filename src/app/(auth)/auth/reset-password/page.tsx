import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Новий пароль" };

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <h1 className="font-display text-3xl font-bold">Новий пароль</h1>
      <ResetPasswordForm />
    </div>
  );
}

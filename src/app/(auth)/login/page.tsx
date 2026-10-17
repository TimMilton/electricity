import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Вхід" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return (
    <div className="flex flex-col gap-6 pt-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Вхід</h1>
        <p className="mt-1 text-ink-soft">Показники лічильника, нарахування та оплати вашої квартири.</p>
      </div>
      {error === "link" && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-4 py-3 text-danger">
          Посилання недійсне або застаріло. Увійдіть або запросіть новий лист.
        </p>
      )}
      <LoginForm next={next} />
    </div>
  );
}

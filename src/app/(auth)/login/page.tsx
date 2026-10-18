import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Вхід" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return (
    <div className="flex flex-col gap-6 pt-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Вхід</h1>
        <p className="mt-1 text-ink-soft">Увійдіть за номером квартири та кодом доступу від адміністратора.</p>
      </div>
      <LoginForm next={next} />
    </div>
  );
}

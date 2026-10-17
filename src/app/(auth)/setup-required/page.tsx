import type { Metadata } from "next";

export const metadata: Metadata = { title: "Потрібне налаштування" };

export default function SetupRequiredPage() {
  return (
    <div className="flex flex-col gap-4 pt-6">
      <h1 className="font-display text-3xl font-bold">Потрібне налаштування</h1>
      <p className="text-ink-soft">
        Застосунок не підключено до бази даних. Заповніть змінні середовища SUPABASE_URL,
        SUPABASE_ANON_KEY та SUPABASE_SERVICE_ROLE_KEY згідно з README і перезапустіть застосунок (у Docker:
        docker compose up -d).
      </p>
    </div>
  );
}

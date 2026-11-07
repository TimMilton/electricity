import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";
import { Notice } from "@/components/ui/controls";

export const metadata: Metadata = { title: "Вхід" };

const NOTICES: Record<string, { tone: "info" | "ok"; title: string; text: string }> = {
  consent: {
    tone: "info",
    title: "Потрібна ваша згода",
    text: "Умови користування застосунком оновлено. Щоб продовжити, увійдіть знову, ознайомтеся з умовами та надайте згоду на обробку персональних даних.",
  },
  erased: {
    tone: "ok",
    title: "Згоду відкликано, ваші персональні дані видалено",
    text: "Прізвище та ім'я видалено, обліковий запис квартири деактивовано. Щоб знову користуватися застосунком, зверніться до адміністратора по новий код доступу.",
  },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;
  return (
    <div className="flex flex-col gap-6 pt-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Вхід</h1>
        <p className="mt-1 text-ink-soft">Увійдіть за номером квартири та кодом доступу від адміністратора.</p>
      </div>
      {notice && (
        <Notice tone={notice.tone} title={notice.title}>
          {notice.text}
        </Notice>
      )}
      <LoginForm next={next} />
    </div>
  );
}

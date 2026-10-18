import type { Metadata } from "next";
import { requireSession, getActingContext } from "@/lib/auth";
import { signOutAction } from "@/app/actions/auth";
import { Button, PageHeader, Panel, Row } from "@/components/ui/controls";
import { ChangePasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Профіль" };

export default async function ProfilePage() {
  const session = await requireSession();
  const ctx = await getActingContext();
  return (
    <>
      <PageHeader title="Профіль" />
      <div className="grid gap-5 md:grid-cols-2">
        <Panel title="Обліковий запис">
          <dl>
            <Row label="Прізвище" value={session.profile.surname} />
            {session.isAdmin && <Row label="Електронна пошта" value={session.email ?? "—"} />}
            <Row label="Роль" value={session.isAdmin ? "Адміністратор" : "Мешканець"} />
            {ctx && !ctx.viewAs && <Row label="Квартира" value={`№${ctx.apartment.apartment_number}`} />}
          </dl>
          <p className="mt-3 text-sm text-ink-soft">
            Щоб змінити прізвище чи прив&apos;язку до квартири, зверніться до адміністратора.
          </p>
          <form action={signOutAction} className="mt-4">
            <Button type="submit" variant="outline">Вийти з облікового запису</Button>
          </form>
        </Panel>
        {session.isAdmin ? (
          <Panel title="Змінити пароль">
            <ChangePasswordForm />
          </Panel>
        ) : (
          <Panel title="Код доступу">
            <p className="text-[15px]">
              Ви входите за номером квартири та кодом доступу. Код діє постійно. Якщо він загубився або ним міг скористатися
              хтось інший, попросіть адміністратора будинку видати новий — старий одразу перестане діяти.
            </p>
          </Panel>
        )}
      </div>
    </>
  );
}

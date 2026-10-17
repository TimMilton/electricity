import Link from "next/link";
import { Eye, LogOut } from "lucide-react";
import { Brand } from "@/components/brand";
import { BottomNav, TopNav } from "@/components/nav";
import { getActingContext, requireSession } from "@/lib/auth";
import { signOutAction } from "@/app/actions/auth";
import { exitViewAsAction } from "@/app/actions/admin";

export default async function ResidentLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const ctx = await getActingContext();

  return (
    <div className="flex min-h-dvh flex-col">
      {ctx?.viewAs && (
        <div className="sticky top-0 z-40 bg-signal text-ink" role="status">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-[15px]">
            <p className="flex items-center gap-2 font-semibold">
              <Eye className="size-4" aria-hidden />
              Ви переглядаєте квартиру №{ctx.apartment.apartment_number} у режимі адміністратора
            </p>
            <form action={exitViewAsAction}>
              <button type="submit" className="rounded-md border border-ink/30 px-3 py-1 text-sm font-semibold hover:bg-white/40">
                Повернутися в панель
              </button>
            </form>
          </div>
        </div>
      )}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <Brand href="/home" />
            {ctx && (
              <span className="hidden rounded-full bg-face-soft px-3 py-1 text-sm font-medium text-face-strong sm:inline">
                Кв. {ctx.apartment.apartment_number}, {ctx.apartment.resident_surname}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {session.isAdmin && !ctx?.viewAs && (
              <Link href="/admin" className="text-[15px] font-medium text-face underline underline-offset-4">
                Адмін-панель
              </Link>
            )}
            <form action={signOutAction}>
              <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3 text-[15px] hover:bg-casing">
                <LogOut className="size-4" aria-hidden />
                <span className="hidden sm:inline">Вийти</span>
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto hidden max-w-5xl px-4 pb-3 md:block">
          <TopNav set="resident" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 md:pb-12">{children}</main>
      <BottomNav set="resident" />
    </div>
  );
}

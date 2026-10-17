import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { Brand } from "@/components/brand";
import { ScrollNav, SideNav } from "@/components/nav";
import { requireAdmin } from "@/lib/auth";
import { signOutAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: { default: "Адміністрування", template: "%s — Адміністрування" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-face text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Brand href="/admin" inverted />
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-sm">Адміністратор</span>
          </div>
          <div className="flex items-center gap-2 text-[15px]">
            <span className="hidden text-white/80 sm:inline">{session.profile.surname}</span>
            <form action={signOutAction}>
              <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3 hover:bg-white/10">
                <LogOut className="size-4" aria-hidden />
                <span className="hidden sm:inline">Вийти</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-5 md:py-6">
        <aside className="hidden w-60 shrink-0 md:block">
          <div className="sticky top-4">
            <SideNav set="admin" />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mb-4 md:hidden">
            <ScrollNav set="admin" />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

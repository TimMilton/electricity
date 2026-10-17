"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck, ClipboardList, FileClock, FileDown, Gauge, Home, LayoutDashboard, PiggyBank, Receipt,
  Settings, User, Users, Wallet, Building2, CalendarRange, Scale, History, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };
export type NavSet = "resident" | "admin";

const SETS: Record<NavSet, NavItem[]> = {
  resident: [
    { href: "/home", label: "Головна", icon: Home },
    { href: "/readings", label: "Показники", icon: Gauge },
    { href: "/residents", label: "Мешканці", icon: Users },
    { href: "/history", label: "Історія", icon: History },
    { href: "/profile", label: "Профіль", icon: User },
  ],
  admin: [
    { href: "/admin", label: "Огляд", icon: LayoutDashboard, exact: true },
    { href: "/admin/payments", label: "Платежі", icon: Wallet },
    { href: "/admin/receipts", label: "Квитанції", icon: Receipt },
    { href: "/admin/apartments", label: "Квартири", icon: Building2 },
    { href: "/admin/readings", label: "Показники", icon: ClipboardList },
    { href: "/admin/common-meter", label: "Загальний лічильник", icon: Gauge },
    { href: "/admin/reconciliation", label: "Розбіжності", icon: Scale },
    { href: "/admin/deposit", label: "Депозит", icon: PiggyBank },
    { href: "/admin/periods", label: "Періоди й тарифи", icon: CalendarRange },
    { href: "/admin/settings", label: "Налаштування", icon: Settings },
    { href: "/admin/audit", label: "Журнал змін", icon: FileClock },
    { href: "/admin/export", label: "Експорт", icon: FileDown },
    { href: "/admin/view-as", label: "Переглянути як мешканець", icon: BookOpenCheck },
  ],
};

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

/** Горизонтальна навігація для широких екранів. */
export function TopNav({ set, inverted }: { set: NavSet; inverted?: boolean }) {
  const pathname = usePathname();
  const items = SETS[set];
  return (
    <nav aria-label="Основна навігація" className="hidden md:block">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3 text-[15px] font-medium",
                  inverted
                    ? active ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
                    : active ? "bg-face text-white" : "text-ink hover:bg-face-soft",
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Нижня панель вкладок для смартфона. */
export function BottomNav({ set }: { set: NavSet }) {
  const pathname = usePathname();
  const items = SETS[set];
  return (
    <nav
      aria-label="Основна навігація"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium leading-none",
                  active ? "text-face" : "text-ink-soft",
                )}
              >
                <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", active && "bg-signal-soft")}>
                  <item.icon className="size-5" aria-hidden />
                </span>
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Горизонтально прокручуване меню розділів (адмін-панель на смартфоні). */
export function ScrollNav({ set }: { set: NavSet }) {
  const pathname = usePathname();
  const items = SETS[set];
  return (
    <nav aria-label="Розділи" className="-mx-4 overflow-x-auto px-4 md:hidden">
      <ul className="flex w-max gap-1.5 pb-1">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
                  active ? "border-face bg-face text-white" : "border-line bg-surface text-ink",
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Бічне меню адмін-панелі для широких екранів. */
export function SideNav({ set }: { set: NavSet }) {
  const pathname = usePathname();
  const items = SETS[set];
  return (
    <nav aria-label="Розділи адміністратора" className="hidden md:block">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-[15px]",
                  active ? "bg-face font-semibold text-white" : "text-ink hover:bg-face-soft",
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

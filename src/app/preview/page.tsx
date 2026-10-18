import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Brand } from "@/components/brand";
import { BottomNav, ScrollNav, SideNav, TopNav } from "@/components/nav";
import { PageHeader } from "@/components/ui/controls";
import { HomeView } from "@/components/views/home-view";
import { AdminOverviewView } from "@/components/views/admin-overview-view";
import { ReadingForm } from "@/components/reading-form";
import { PaymentFlow } from "@/components/payment-flow";
import { ResidentsTable } from "@/components/residents-table";
import { WindowNotice } from "@/components/charges";
import { periodLabel } from "@/lib/utils";
import { demoApartment, demoHouse, demoPayment, demoPeriod, demoReading, demoReport, demoTable } from "./demo-data";
import { HouseSummaryPanel } from "@/components/house-summary";

export const metadata: Metadata = { title: "Попередній перегляд" };

/**
 * Попередній перегляд інтерфейсу на вигаданих даних — без бази та входу.
 * Доступний у режимі розробки або коли ENABLE_PREVIEW=1. Кнопки, що надсилають
 * дані, тут не працюють.
 */
const SCREENS = {
  home: "Головна мешканця",
  readings: "Внесення показників",
  pay: "Оплата",
  residents: "Список мешканців",
  admin: "Огляд адміністратора",
} as const;
type Screen = keyof typeof SCREENS;

function previewEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_PREVIEW === "1";
}

export default async function PreviewPage({ searchParams }: PageProps<"/preview">) {
  await connection(); // прапорець ENABLE_PREVIEW читається під час запиту, а не збірки
  if (!previewEnabled()) notFound();
  const sp = await searchParams;
  const screen = (typeof sp.screen === "string" && sp.screen in SCREENS ? sp.screen : "home") as Screen;

  const switcher = (
    <div className="no-print border-b border-signal bg-signal-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-[15px]">
        <span className="font-semibold">Попередній перегляд, вигадані дані:</span>
        {(Object.keys(SCREENS) as Screen[]).map((s) => (
          <Link key={s} href={`/preview?screen=${s}`} aria-current={s === screen ? "page" : undefined}
            className={s === screen ? "font-semibold underline underline-offset-4" : "text-face underline-offset-4 hover:underline"}>
            {SCREENS[s]}
          </Link>
        ))}
      </div>
    </div>
  );

  if (screen === "admin") {
    return (
      <div className="flex min-h-dvh flex-col">
        {switcher}
        <header className="bg-face text-white">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
            <Brand href="/preview?screen=admin" inverted />
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-sm">Адміністратор</span>
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-5 md:py-6">
          <aside className="hidden w-60 shrink-0 md:block"><SideNav set="admin" /></aside>
          <main className="min-w-0 flex-1">
            <div className="mb-4 md:hidden"><ScrollNav set="admin" /></div>
            <AdminOverviewView period={demoPeriod} periods={[demoPeriod]} report={demoReport} />
          </main>
        </div>
      </div>
    );
  }

  let content: React.ReactNode;
  if (screen === "home") {
    content = (
      <HomeView
        apartment={demoApartment}
        period={demoPeriod}
        isAdmin={false}
        otherEnabled={false}
        deposit={{ is_public: true, balance: "1480.00" }}
        house={demoHouse}
        state={{
          reading: demoReading,
          charges: { deposit: "50.00", hallLighting: "15.50", other: "0.00" },
          payment: demoPayment,
          receipts: [],
          previous: { value: "12345.67", recordedAt: null },
        }}
      />
    );
  } else if (screen === "readings") {
    content = (
      <>
        <PageHeader title="Показники" description={`Квартира №12, ${periodLabel(demoPeriod).toLowerCase()}`} />
        <div className="mb-5"><WindowNotice period={demoPeriod} /></div>
        <ReadingForm
          periodId={demoPeriod.id}
          periodLabel={periodLabel(demoPeriod)}
          previous="12345.67"
          previousCaption="Зафіксовано 03.09.2026 (серпень 2026)"
          tariff="4.3200"
          initial={{ current: "12478.12", deposit: "50", hallLighting: "15.50", other: "" }}
          otherEnabled={false}
          maxContribution="10000"
          isAdmin={false}
          hasExisting={false}
        />
      </>
    );
  } else if (screen === "pay") {
    content = (
      <>
        <PageHeader title="Оплата" description="Квартира №12, вересень 2026" />
        <PaymentFlow
          paymentId="00000000-0000-4000-8000-0000000000aa"
          periodLabel={periodLabel(demoPeriod)}
          amounts={{ electricity: "572.18", deposit: "50.00", hallLighting: "15.50", other: "0.00", total: "637.68" }}
          envelopeUrl="https://example.com/envelope"
          maxSizeMb={10}
          showOther={false}
          rejectionReason={null}
        />
      </>
    );
  } else {
    content = (
      <>
        <PageHeader title="Список мешканців" description="Показники та нарахування всіх квартир за обраний місяць." />
        <div className="flex flex-col gap-5">
          <HouseSummaryPanel summary={demoHouse} compact />
          <ResidentsTable rows={demoTable} periodId={demoPeriod.id} maxSizeMb={10} />
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {switcher}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Brand href="/preview" />
          <span className="hidden rounded-full bg-face-soft px-3 py-1 text-sm font-medium text-face-strong sm:inline">Кв. 12, Приклад</span>
        </div>
        <div className="mx-auto hidden max-w-5xl px-4 pb-3 md:block"><TopNav set="resident" /></div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 md:pb-12">{content}</main>
      <BottomNav set="resident" />
    </div>
  );
}

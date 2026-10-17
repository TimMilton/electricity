import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { resolvePeriod } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui/controls";
import { AdminOverviewView } from "@/components/views/admin-overview-view";
import type { HouseReport } from "@/lib/types";

export const metadata: Metadata = { title: "Огляд" };

export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const sp = await searchParams;
  const { period, periods } = await resolvePeriod(sp.period);

  if (!period) {
    return (
      <>
        <PageHeader title="Огляд" />
        <EmptyState title="Розрахункових періодів ще немає">
          Почніть із налаштування: додайте квартири, встановіть тариф і створіть перший період.{" "}
          <Link href="/admin/periods" className="text-face underline underline-offset-4">Перейти до періодів</Link>
        </EmptyState>
      </>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_admin_overview", { p_period_id: period.id });
  return <AdminOverviewView period={period} periods={periods} report={data as HouseReport} />;
}

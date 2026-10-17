import type { Metadata } from "next";
import { requireActingContext } from "@/lib/auth";
import { getCurrentPeriod, getSettings } from "@/lib/data";
import { getApartmentPeriodState } from "@/lib/resident-data";
import { createClient } from "@/lib/supabase/server";
import { HomeView } from "@/components/views/home-view";

export const metadata: Metadata = { title: "Головна" };

export default async function HomePage() {
  const ctx = await requireActingContext();
  const [period, settings] = await Promise.all([getCurrentPeriod(), getSettings()]);
  const state = period ? await getApartmentPeriodState(ctx.apartment.id, period.id) : null;
  const supabase = await createClient();
  const { data: deposit } = await supabase.rpc("get_deposit_summary");
  return (
    <HomeView
      apartment={ctx.apartment}
      period={period}
      isAdmin={ctx.session.isAdmin}
      otherEnabled={settings.other_charges_enabled}
      deposit={deposit as { is_public: boolean; balance: number | null } | null}
      state={state}
    />
  );
}

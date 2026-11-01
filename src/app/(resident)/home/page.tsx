import type { Metadata } from "next";
import { requireActingContext } from "@/lib/auth";
import { getCurrentPeriod, getSettings } from "@/lib/data";
import { getApartmentPeriodState, getUnpaidPayments } from "@/lib/resident-data";
import { createClient } from "@/lib/supabase/server";
import { HomeView } from "@/components/views/home-view";
import { getHouseReceiptViews } from "@/lib/house-receipts";
import type { HouseSummary } from "@/lib/types";

export const metadata: Metadata = { title: "Головна" };

export default async function HomePage() {
  const ctx = await requireActingContext();
  const [period, settings] = await Promise.all([getCurrentPeriod(), getSettings()]);
  const [state, unpaid] = await Promise.all([
    period ? getApartmentPeriodState(ctx.apartment.id, period.id) : Promise.resolve(null),
    getUnpaidPayments(ctx.apartment.id),
  ]);
  const supabase = await createClient();
  const [{ data: deposit }, { data: house, error: houseError }] = await Promise.all([
    supabase.rpc("get_deposit_summary"),
    supabase.rpc("get_house_summary", { p_period_id: null }),
  ]);
  if (houseError) console.error("get_house_summary:", houseError.code, houseError.message);
  const houseReceipts = await getHouseReceiptViews((house as HouseSummary | null)?.period?.id);
  return (
    <HomeView
      apartment={ctx.apartment}
      period={period}
      isAdmin={ctx.session.isAdmin}
      otherEnabled={settings.other_charges_enabled}
      deposit={deposit as { is_public: boolean; balance: number | null } | null}
      house={house as HouseSummary | null}
      houseFailed={Boolean(houseError)}
      envelopeUrl={settings.envelope_url}
      houseReceipts={houseReceipts}
      unpaidElsewhere={unpaid.filter((u) => u.periodId !== period?.id)}
      state={state}
    />
  );
}

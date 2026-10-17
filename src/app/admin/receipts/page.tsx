import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listPeriods } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { signedReceipts } from "@/lib/receipts";
import { formatDateTime, periodLabel } from "@/lib/utils";
import { EmptyState, PageHeader, Panel } from "@/components/ui/controls";
import { PeriodPicker } from "@/components/period-picker";
import { ReceiptList } from "@/components/receipt-list";
import { PaymentStatusBadge } from "@/components/ui/status";
import type { PaymentStatus, Receipt } from "@/lib/types";

export const metadata: Metadata = { title: "Квитанції" };

type Row = Receipt & {
  payments: {
    id: string;
    status: PaymentStatus;
    billing_period_id: string;
    apartments: { apartment_number: string; resident_surname: string } | null;
    billing_periods: { year: number; month: number } | null;
  } | null;
};

export default async function AdminReceiptsPage({ searchParams }: PageProps<"/admin/receipts">) {
  await requireAdmin();
  const sp = await searchParams;
  const periods = await listPeriods();
  const periodId = typeof sp.period === "string" && periods.some((p) => p.id === sp.period) ? sp.period : periods[0]?.id;
  const supabase = await createClient();
  let q = supabase
    .from("receipts")
    .select("*, payments!inner(id, status, billing_period_id, apartments(apartment_number, resident_surname), billing_periods(year, month))")
    .order("created_at", { ascending: false })
    .limit(200);
  if (periodId) q = q.eq("payments.billing_period_id", periodId);
  const { data } = await q;
  const rows = (data ?? []) as Row[];
  const views = await signedReceipts(supabase, rows);

  return (
    <>
      <PageHeader title="Квитанції" description="Завантажені квитанції за місяць. Посилання на перегляд діють кілька хвилин." />
      <div className="mb-4">
        <PeriodPicker periods={periods} selectedId={periodId} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Квитанцій за цей місяць немає" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r, i) => (
            <Panel key={r.id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/payments/${r.payments?.id}`} className="font-semibold text-face underline underline-offset-4">
                  Кв. {r.payments?.apartments?.apartment_number}, {r.payments?.apartments?.resident_surname}
                </Link>
                {r.payments && <PaymentStatusBadge status={r.payments.status} />}
              </div>
              <p className="mb-2 text-sm text-ink-soft">
                {r.payments?.billing_periods ? periodLabel(r.payments.billing_periods) : ""}, завантажено {formatDateTime(r.created_at)}
              </p>
              <ReceiptList receipts={[views[i]!]} compact />
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

import type { Metadata } from "next";
import { requireActingContext } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { listApartmentDepositItems } from "@/lib/deposit-topups";
import { formatMoney, fromDb } from "@/lib/money";
import { PageHeader, Panel, Row } from "@/components/ui/controls";
import { DepositTopupForm } from "@/components/deposit-topup-form";
import { DepositItemsList } from "@/components/deposit-topups";

export const metadata: Metadata = { title: "Внесок у депозит" };

export default async function DepositTopupPage() {
  const ctx = await requireActingContext();
  const supabase = await createClient();
  const [settings, items, { data: dep }] = await Promise.all([
    getSettings(),
    listApartmentDepositItems(ctx.apartment.id),
    supabase.rpc("get_deposit_summary"),
  ]);
  const summary = dep as { is_public: boolean; balance: number | null; total_contributions: number | null } | null;
  const sum = (pred: (s: string) => boolean) => items.filter((i) => pred(i.status)).reduce((acc, i) => acc + (fromDb(i.amount, 2) ?? 0n), 0n);
  const confirmed = sum((s) => s === "paid");
  const pending = sum((s) => s === "pending_review");
  const declared = sum((s) => s === "awaiting_payment");

  return (
    <>
      <PageHeader
        title="Внесок у депозит"
        description={`Квартира №${ctx.apartment.apartment_number}. Поповнити депозит будинку можна будь-коли — незалежно від подання показників.`}
      />
      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
        <Panel title="Новий внесок" description="Перекажіть суму на спільний конверт і прикріпіть квитанцію. Після перевірки адміністратором внесок буде зараховано до депозиту.">
          <DepositTopupForm envelopeUrl={settings.envelope_url} maxSizeMb={settings.max_receipt_size_mb} maxAmount={String(settings.max_contribution_amount)} />
        </Panel>
        <Panel title="Депозит">
          <dl>
            {summary?.is_public && summary.balance !== null && (
              <>
                <Row label="Баланс депозиту будинку" value={formatMoney(summary.balance)} strong />
                {summary.total_contributions !== null && (
                  <Row label="Усього внесків усіх квартир" value={formatMoney(summary.total_contributions)} />
                )}
              </>
            )}
            <Row label="Зараховано від вашої квартири" value={formatMoney(confirmed)} strong={!summary?.is_public} />
            {pending > 0n && <Row label="На перевірці" value={formatMoney(pending)} />}
            {declared > 0n && <Row label="Заявлено з показниками, ще не оплачено" value={formatMoney(declared)} />}
          </dl>
          <p className="mt-3 text-sm text-ink-soft">
            Враховано обидва способи: поле «Депозит» разом із показниками за місяць і окремі внески з цієї сторінки.
          </p>
        </Panel>
      </div>
      <Panel title="Усі мої внески в депозит" className="mt-5">
        <DepositItemsList items={items} />
      </Panel>
    </>
  );
}

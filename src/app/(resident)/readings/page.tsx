import type { Metadata } from "next";
import Link from "next/link";
import { requireActingContext } from "@/lib/auth";
import { getCurrentPeriod, getSettings, listPeriods } from "@/lib/data";
import { getApartmentPeriodState } from "@/lib/resident-data";
import { periodPhase } from "@/lib/period";
import { formatDate, periodLabel } from "@/lib/utils";
import { EmptyState, Notice, PageHeader, Select, Button } from "@/components/ui/controls";
import { WindowNotice } from "@/components/charges";
import { ReadingForm } from "@/components/reading-form";

export const metadata: Metadata = { title: "Показники" };

function plain(v: string | number | null | undefined, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v);
  return s === "0" || s === "0.00" ? "" : s;
}

export default async function ReadingsPage({ searchParams }: PageProps<"/readings">) {
  const ctx = await requireActingContext();
  const isAdmin = ctx.session.isAdmin;
  const sp = await searchParams;
  const current = await getCurrentPeriod();
  const periods = isAdmin ? await listPeriods() : [];
  const period = (isAdmin && typeof sp.period === "string" && periods.find((p) => p.id === sp.period)) || current;
  const settings = await getSettings();

  if (!period) {
    return (
      <>
        <PageHeader title="Показники" />
        <EmptyState title="Розрахунковий період ще не створено">Адміністратор ще не відкрив приймання показників.</EmptyState>
      </>
    );
  }

  const state = await getApartmentPeriodState(ctx.apartment.id, period.id);
  const phase = periodPhase(period);
  const status = state.payment?.status ?? "awaiting_payment";
  const lockedByPayment = !isAdmin && (status === "pending_review" || status === "paid");
  const windowClosed = phase !== "open";
  const adminBlocked = isAdmin && period.status === "closed" && !period.allow_admin_edit_after_close;
  const canEdit = isAdmin ? !adminBlocked : !windowClosed && !lockedByPayment;

  const caption =
    state.previous.source === "reading"
      ? `Зафіксовано ${formatDate(state.previous.recordedAt)}${state.previous.label ? ` (${state.previous.label.toLowerCase()})` : ""}`
      : state.previous.source === "initial"
        ? `Початковий показник${state.previous.recordedAt ? ` на ${formatDate(state.previous.recordedAt)}` : ""}`
        : null;

  return (
    <>
      <PageHeader
        title="Показники"
        description={`Квартира №${ctx.apartment.apartment_number}, ${periodLabel(period).toLowerCase()}`}
      />
      {isAdmin && periods.length > 1 && (
        <form className="mb-5 flex flex-wrap items-end gap-2" method="get">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Період
            <Select name="period" defaultValue={period.id} className="w-56">
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p)}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="outline">Показати</Button>
        </form>
      )}
      <div className="mb-5">
        <WindowNotice period={period} isAdmin={isAdmin} />
      </div>
      {lockedByPayment && (
        <Notice tone="info" className="mb-5" title="Платіж уже подано">
          Показники та внески за цей місяць зафіксовано у платежі. Якщо потрібно щось виправити, зверніться до адміністратора.{" "}
          <Link href="/home" className="underline underline-offset-4">На головну</Link>
        </Notice>
      )}
      {isAdmin && state.payment && (status === "pending_review" || status === "paid") && (
        <Notice tone="warn" className="mb-5">
          Платіж має статус «{status === "paid" ? "Сплачено" : "На перевірці"}». Зміна показників не змінить зафіксовану суму платежу —
          різницю буде показано як попередження.
        </Notice>
      )}
      {canEdit ? (
        <ReadingForm
          periodId={period.id}
          periodLabel={periodLabel(period)}
          previous={state.previous.value}
          previousCaption={caption}
          tariff={state.tariff}
          initial={{
            current: state.reading ? String(state.reading.current_reading) : "",
            deposit: plain(state.charges?.deposit),
            hallLighting: plain(state.charges?.hallLighting),
            other: plain(state.charges?.other),
          }}
          otherEnabled={settings.other_charges_enabled || (isAdmin && state.charges?.other !== undefined && Number(state.charges.other) > 0)}
          maxContribution={String(settings.max_contribution_amount)}
          isAdmin={isAdmin}
          hasExisting={!!state.reading}
        />
      ) : (
        <Button asChild variant="outline">
          <Link href="/home">Повернутися на головну</Link>
        </Button>
      )}
    </>
  );
}

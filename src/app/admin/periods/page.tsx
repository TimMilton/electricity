import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getSettings, listPeriods, listTariffs } from "@/lib/data";
import { periodPhase } from "@/lib/period";
import { formatTariff } from "@/lib/money";
import { formatDate, formatDateTime, periodLabel, toKyivLocalInput } from "@/lib/utils";
import { EmptyState, PageHeader, Panel } from "@/components/ui/controls";
import { Tag } from "@/components/ui/status";
import { CreatePeriodForm, DeleteTariffButton, PeriodEditor, TariffForm } from "@/components/admin/periods";

export const metadata: Metadata = { title: "Періоди й тарифи" };

const PHASE: Record<string, { text: string; tone: "signal" | "neutral" | "warn" | "face" }> = {
  open: { text: "Приймання відкрите", tone: "signal" },
  before: { text: "Заплановано", tone: "face" },
  after: { text: "Вікно минуло", tone: "warn" },
  closed: { text: "Закрито", tone: "neutral" },
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default async function PeriodsPage() {
  await requireAdmin();
  const [periods, tariffs, settings] = await Promise.all([listPeriods(), listTariffs(), getSettings()]);
  const todayKyiv = toKyivLocalInput(new Date()).slice(0, 10);

  // Типові значення для нового періоду
  const last = periods[0];
  let year: number, month: number;
  if (last) {
    year = last.month === 12 ? last.year + 1 : last.year;
    month = last.month === 12 ? 1 : last.month + 1;
  } else {
    const [y, m] = todayKyiv.split("-").map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 - (settings.window_for_previous_month ? 1 : 0), 1));
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
  }
  const base = new Date(Date.UTC(year, month - 1 + (settings.window_for_previous_month ? 1 : 0), 1));
  const by = base.getUTCFullYear();
  const bm = pad(base.getUTCMonth() + 1);
  const defaults = {
    year,
    month,
    windowStart: `${by}-${bm}-${pad(settings.default_window_start_day)}T${pad(settings.default_window_start_hour)}:00`,
    windowEnd: `${by}-${bm}-${pad(settings.default_window_end_day)}T${pad(settings.default_window_end_hour)}:59`,
  };

  return (
    <>
      <PageHeader title="Періоди й тарифи" description="Розрахункові місяці, вікна приймання показників і тарифи." />
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Розрахункові періоди">
          {periods.length === 0 ? (
            <EmptyState title="Періодів ще немає">Створіть перший період праворуч.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {periods.map((p) => {
                const ph = PHASE[periodPhase(p)]!;
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold">{periodLabel(p)}</p>
                      <p className="text-sm text-ink-soft">
                        {formatDateTime(p.reading_window_start)} – {formatDateTime(p.reading_window_end)}
                        {!p.allow_admin_edit_after_close && ", без виправлень після закриття"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tag tone={ph.tone}>{ph.text}</Tag>
                      <PeriodEditor
                        periodId={p.id}
                        label={periodLabel(p)}
                        windowStart={toKyivLocalInput(p.reading_window_start)}
                        windowEnd={toKyivLocalInput(p.reading_window_end)}
                        allowAdminEditAfterClose={p.allow_admin_edit_after_close}
                        closed={p.status === "closed"}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <div className="flex flex-col gap-5">
          <Panel title="Новий період">
            <CreatePeriodForm defaults={defaults} />
          </Panel>
          <Panel title="Тарифи">
            <TariffForm today={todayKyiv} />
            <ul className="mt-5 divide-y divide-line border-t border-line">
              {tariffs.length === 0 && <li className="py-3 text-ink-soft">Тариф ще не встановлено — розрахунок неможливий.</li>}
              {tariffs.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="tabular font-semibold">{formatTariff(t.rate_per_kwh)}</p>
                    <p className="text-sm text-ink-soft">
                      з {formatDate(t.valid_from)}
                      {t.valid_until ? ` до ${formatDate(t.valid_until)}` : ", діє зараз"}
                    </p>
                  </div>
                  {t.valid_from > todayKyiv && <DeleteTariffButton tariffId={t.id} />}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { resolvePeriod } from "@/lib/data";
import { periodLabel } from "@/lib/utils";
import { Button, PageHeader, Panel } from "@/components/ui/controls";
import { PeriodPicker } from "@/components/period-picker";

export const metadata: Metadata = { title: "Експорт" };

const EXPORTS = [
  { kind: "report", title: "Зведення за будинком", text: "Лічильники, розбіжність, нарахування, платежі та рух депозиту за місяць.", perPeriod: true },
  { kind: "table", title: "Таблиця мешканців", text: "Показники, внески, суми та статуси оплат усіх квартир за місяць.", perPeriod: true },
  { kind: "payments", title: "Платежі", text: "Усі платежі за місяць із датами подання й підтвердження.", perPeriod: true },
  { kind: "deposit", title: "Журнал депозиту", text: "Усі операції депозиту з підставами.", perPeriod: false },
  { kind: "audit", title: "Журнал змін", text: "Останні 5000 записів журналу змін.", perPeriod: false },
] as const;

export default async function ExportPage({ searchParams }: PageProps<"/admin/export">) {
  await requireAdmin();
  const sp = await searchParams;
  const { period, periods } = await resolvePeriod(sp.period);
  return (
    <>
      <PageHeader title="Експорт" description="Файли CSV (роздільник «;», UTF-8) відкриваються в Excel, LibreOffice та Google Таблицях." />
      <div className="mb-4"><PeriodPicker periods={periods} selectedId={period?.id} /></div>
      <div className="grid gap-4 md:grid-cols-2">
        {EXPORTS.map((e) => {
          const disabled = e.perPeriod && !period;
          const href = `/api/export/${e.kind}${e.perPeriod && period ? `?period=${period.id}` : ""}`;
          return (
            <Panel key={e.kind} title={e.title} description={e.perPeriod && period ? `${e.text} Період: ${periodLabel(period).toLowerCase()}.` : e.text}>
              {disabled ? (
                <p className="text-ink-soft">Спочатку створіть розрахунковий період.</p>
              ) : (
                <Button asChild variant="outline">
                  <a href={href}><FileDown aria-hidden />Завантажити CSV</a>
                </Button>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

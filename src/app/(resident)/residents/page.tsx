import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { getPeriodTable, getSettings, resolvePeriod } from "@/lib/data";
import { periodLabel } from "@/lib/utils";
import { Button, EmptyState, PageHeader, Select } from "@/components/ui/controls";
import { ResidentsTable } from "@/components/residents-table";

export const metadata: Metadata = { title: "Список мешканців" };

export default async function ResidentsPage({ searchParams }: PageProps<"/residents">) {
  await requireSession();
  const sp = await searchParams;
  const { period, periods } = await resolvePeriod(sp.period);
  const settings = await getSettings();

  return (
    <>
      <PageHeader title="Список мешканців" description="Показники та нарахування всіх квартир за обраний місяць." />
      {periods.length > 0 && (
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Розрахунковий місяць
            <Select name="period" defaultValue={period?.id} className="w-60">
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
      {period ? (
        <ResidentsTable rows={await getPeriodTable(period.id)} periodId={period.id} maxSizeMb={settings.max_receipt_size_mb} />
      ) : (
        <EmptyState title="Даних ще немає">Розрахункові періоди ще не створено.</EmptyState>
      )}
    </>
  );
}

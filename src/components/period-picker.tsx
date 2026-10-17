import { Button, Select } from "@/components/ui/controls";
import { periodLabel } from "@/lib/utils";
import type { BillingPeriod } from "@/lib/types";

export function PeriodPicker({
  periods,
  selectedId,
  extra,
  label = "Розрахунковий місяць",
}: {
  periods: BillingPeriod[];
  selectedId?: string;
  extra?: Record<string, string | undefined>;
  label?: string;
}) {
  if (periods.length === 0) return null;
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      {Object.entries(extra ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {label}
        <Select name="period" defaultValue={selectedId} className="w-56">
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {periodLabel(p)}
              {p.status === "open" ? " (відкрито)" : ""}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" variant="outline">
        Показати
      </Button>
    </form>
  );
}

/** Картка ключового показника. */
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warn" | "ok" | "danger" | "signal" }) {
  const accent = { warn: "border-l-warn", ok: "border-l-ok", danger: "border-l-danger", signal: "border-l-signal" }[tone ?? "signal"];
  return (
    <div className={`rounded-[var(--radius-control)] border border-line border-l-4 bg-surface px-4 py-3 ${tone ? accent : "border-l-face/30"}`}>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="tabular mt-0.5 text-xl font-bold leading-tight">{value}</p>
      {hint && <p className="mt-0.5 text-sm text-ink-soft">{hint}</p>}
    </div>
  );
}

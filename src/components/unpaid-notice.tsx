import Link from "next/link";
import { Notice } from "@/components/ui/controls";
import { formatMoney } from "@/lib/money";
import { periodLabel } from "@/lib/utils";
import type { UnpaidPayment } from "@/lib/resident-data";

/** Неоплачені місяці з посиланням на оплату (оплатити можна і після закриття приймання показників). */
export function UnpaidNotice({ items, className }: { items: UnpaidPayment[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <Notice tone="signal" title={items.length === 1 ? "Є неоплачене нарахування" : "Є неоплачені нарахування"} className={className}>
      <ul className="mt-1 flex flex-col gap-1.5">
        {items.map((u) => (
          <li key={u.periodId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {periodLabel(u)}: <span className="tabular font-semibold">{formatMoney(u.total)}</span>
              {u.status === "rejected" && " (оплату не підтверджено)"}
            </span>
            <Link href={`/pay?period=${u.periodId}`} className="font-semibold underline underline-offset-4">
              Оплатити
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">Оплатити можна будь-коли, зокрема після завершення приймання показників.</p>
    </Notice>
  );
}

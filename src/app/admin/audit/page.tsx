import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { Button, EmptyState, PageHeader, Select } from "@/components/ui/controls";

export const metadata: Metadata = { title: "Журнал змін" };

const PAGE = 50;

const ACTION_LABEL: Record<string, string> = {
  "reading.create": "Внесено показник",
  "reading.update": "Змінено показник",
  "payment.submit": "Платіж подано на перевірку",
  "payment.approve": "Оплату підтверджено",
  "payment.reject": "Оплату відхилено",
  "receipt.add": "Додано квитанцію",
  "deposit.discrepancy_adjustment": "Депозит використано на розбіжність",
  "deposit.correction": "Коригування депозиту",
  "deposit.refund": "Повернення з депозиту",
  "common_reading.create": "Внесено показник загального лічильника",
  "common_reading.update": "Змінено показник загального лічильника",
  "common_reading.delete": "Видалено показник загального лічильника",
  "reconciliation.delete": "Видалено розрахунок розбіжності",
  "reconciliation.calculate": "Розраховано розбіжність",
  "reconciliation.review": "Розбіжність перевірено",
  "reconciliation.close": "Розбіжність закрито",
  "period.create": "Створено період",
  "period.update": "Змінено період",
  "period.close": "Закрито приймання",
  "period.reopen": "Повторно відкрито приймання",
  "tariff.create": "Встановлено тариф",
  "tariff.delete": "Видалено майбутній тариф",
  "apartment.create": "Додано квартиру",
  "apartment.update": "Змінено квартиру",
  "apartment.import": "Імпорт квартир",
  "apartment.code_generate": "Згенеровано код реєстрації",
  "apartment.code_revoke": "Скасовано код реєстрації",
  "user.register": "Реєстрація мешканця",
  "user.activate": "Користувача активовано",
  "user.deactivate": "Користувача деактивовано",
  "user.role_change": "Змінено роль",
  "user.bootstrap_admin": "Створено першого адміністратора",
  "settings.update": "Змінено налаштування",
};

const GROUPS: Record<string, string> = {
  reading: "Показники",
  payment: "Платежі",
  receipt: "Квитанції",
  deposit: "Депозит",
  common_reading: "Загальний лічильник",
  reconciliation: "Розбіжності",
  period: "Періоди",
  tariff: "Тарифи",
  apartment: "Квартири",
  user: "Користувачі",
  settings: "Налаштування",
};

type Log = {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
};

function diff(prev: Record<string, unknown> | null, next: Record<string, unknown> | null): [string, unknown, unknown][] {
  if (!next && !prev) return [];
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
  const skip = new Set(["updated_at", "created_at", "id", "registration_code_hash"]);
  const out: [string, unknown, unknown][] = [];
  for (const k of keys) {
    if (skip.has(k)) continue;
    const a = prev?.[k];
    const b = next?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push([k, a, b]);
  }
  return out.slice(0, 20);
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const group = typeof sp.group === "string" && sp.group in GROUPS ? sp.group : "";
  const entity = typeof sp.entity === "string" && /^[0-9a-f-]{36}$/i.test(sp.entity) ? sp.entity : "";
  const supabase = await createClient();
  let q = supabase.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (group) q = q.like("action_type", `${group}.%`);
  if (entity) q = q.eq("entity_id", entity);
  const [{ data, count }, { data: users }] = await Promise.all([q, supabase.rpc("admin_list_users")]);
  const logs = (data ?? []) as Log[];
  const names = new Map(((users ?? []) as { auth_user_id: string; surname: string; email: string; apartment_number: string | null }[])
    .map((u) => [u.auth_user_id, `${u.surname}${u.apartment_number ? `, кв. ${u.apartment_number}` : ""}`]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (p: number) => `/admin/audit?${new URLSearchParams({ ...(group ? { group } : {}), ...(entity ? { entity } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Журнал змін" description="Усі зміни даних з автором, часом, причиною та попередніми значеннями. Записи не редагуються." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Розділ
          <Select name="group" defaultValue={group} className="w-56">
            <option value="">Усі</option>
            {Object.entries(GROUPS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="outline">Показати</Button>
        {entity && <Link href="/admin/audit" className="text-face underline underline-offset-4">Скинути фільтр запису</Link>}
      </form>
      {logs.length === 0 ? (
        <EmptyState title="Записів немає" />
      ) : (
        <ol className="flex flex-col gap-2">
          {logs.map((l) => {
            const changes = diff(l.previous_values, l.new_values);
            return (
              <li key={l.id} className="rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{ACTION_LABEL[l.action_type] ?? l.action_type}</p>
                  <p className="text-sm text-ink-soft">{formatDateTime(l.created_at)}</p>
                </div>
                <p className="text-sm text-ink-soft">
                  {l.actor_user_id ? names.get(l.actor_user_id) ?? "Користувач" : "Система"}
                  {l.actor_role === "admin" ? " (адміністратор)" : ""}
                </p>
                {l.reason && <p className="mt-1 text-[15px]">Причина: {l.reason}</p>}
                {changes.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-face">Змінені поля ({changes.length})</summary>
                    <table className="mt-2 w-full text-sm">
                      <thead className="text-left text-ink-soft">
                        <tr><th className="pr-3 font-medium">Поле</th><th className="pr-3 font-medium">Було</th><th className="font-medium">Стало</th></tr>
                      </thead>
                      <tbody>
                        {changes.map(([k, a, b]) => (
                          <tr key={k} className="border-t border-line align-top">
                            <td className="py-1 pr-3 font-mono text-xs">{k}</td>
                            <td className="max-w-[16rem] break-words py-1 pr-3">{show(a)}</td>
                            <td className="max-w-[16rem] break-words py-1">{show(b)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {pages > 1 && (
        <nav aria-label="Сторінки журналу" className="mt-4 flex items-center gap-3">
          {page > 1 && <Link className="text-face underline underline-offset-4" href={link(page - 1)}>Новіші</Link>}
          <span className="text-ink-soft">Сторінка {page} з {pages}</span>
          {page < pages && <Link className="text-face underline underline-offset-4" href={link(page + 1)}>Старіші</Link>}
        </nav>
      )}
    </>
  );
}

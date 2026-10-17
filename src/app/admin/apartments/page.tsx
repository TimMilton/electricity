import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatReading } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { Button, EmptyState, PageHeader, Panel } from "@/components/ui/controls";
import { Tag } from "@/components/ui/status";
import { ApartmentEditor, BulkCodes, CodeButton, ImportApartments, UserActions } from "@/components/admin/apartments";
import { enterViewAsAction } from "@/app/actions/admin";
import type { RegistrationStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Квартири та мешканці" };

type AptRow = {
  id: string;
  apartment_number: string;
  resident_surname: string;
  is_active: boolean;
  registration_status: RegistrationStatus;
  has_active_code: boolean;
  code_created_at: string | null;
  is_locked: boolean;
  initial_reading: number | null;
  initial_reading_date: string | null;
  accounts_count: number;
};

type UserRow = {
  profile_id: string;
  auth_user_id: string;
  email: string;
  surname: string;
  apartment_number: string | null;
  role: "resident" | "admin";
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
};

const REG_LABEL: Record<RegistrationStatus, { text: string; tone: "ok" | "neutral" | "signal" }> = {
  registered: { text: "Зареєстровано", tone: "ok" },
  not_registered: { text: "Не зареєстровано", tone: "neutral" },
  additional_allowed: { text: "Дозволено додатковий акаунт", tone: "signal" },
};

export default async function AdminApartmentsPage() {
  const session = await requireAdmin();
  const supabase = await createClient();
  const [{ data: apts }, { data: users }] = await Promise.all([supabase.rpc("admin_list_apartments"), supabase.rpc("admin_list_users")]);
  const apartments = (apts ?? []) as AptRow[];
  const userRows = (users ?? []) as UserRow[];

  return (
    <>
      <PageHeader title="Квартири та мешканці" actions={<ApartmentEditor />} />
      <div className="flex flex-col gap-5">
        <Panel title={`Квартири (${apartments.length})`}>
          {apartments.length === 0 ? (
            <EmptyState title="Квартир ще немає">Додайте квартири вручну або імпортуйте список нижче.</EmptyState>
          ) : (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[820px] text-[15px]">
                <thead className="bg-casing text-left text-sm text-ink-soft">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Кв.</th>
                    <th className="px-3 py-2.5 font-medium">Прізвище</th>
                    <th className="px-3 py-2.5 font-medium">Реєстрація</th>
                    <th className="px-3 py-2.5 font-medium">Код</th>
                    <th className="px-3 py-2.5 text-right font-medium">Початковий показник</th>
                    <th className="px-3 py-2.5 font-medium"><span className="sr-only">Дії</span></th>
                  </tr>
                </thead>
                <tbody>
                  {apartments.map((a) => (
                    <tr key={a.id} className={`border-t border-line ${a.is_active ? "" : "text-ink-soft"}`}>
                      <td className="px-4 py-2.5 font-semibold">{a.apartment_number}</td>
                      <td className="px-3 py-2.5">
                        {a.resident_surname}
                        {!a.is_active && <span className="ml-2"><Tag>Неактивна</Tag></span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Tag tone={REG_LABEL[a.registration_status].tone}>{REG_LABEL[a.registration_status].text}</Tag>
                        {a.accounts_count > 1 && <span className="ml-1 text-sm text-ink-soft">акаунтів: {a.accounts_count}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-sm">
                        {a.is_locked ? (
                          <Tag tone="danger">Заблоковано</Tag>
                        ) : a.has_active_code ? (
                          <span className="text-ink-soft">Видано {formatDateTime(a.code_created_at)}</span>
                        ) : (
                          <span className="text-ink-soft">—</span>
                        )}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{a.initial_reading === null ? "—" : formatReading(a.initial_reading)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {a.is_active && (
                            <CodeButton
                              apartmentId={a.id}
                              number={a.apartment_number}
                              hasPrimary={a.registration_status === "registered" || a.accounts_count > 0}
                              hasCode={a.has_active_code}
                            />
                          )}
                          <form action={enterViewAsAction}>
                            <input type="hidden" name="apartmentId" value={a.id} />
                            <Button type="submit" size="sm" variant="ghost">Переглянути</Button>
                          </form>
                          <ApartmentEditor apartment={a} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Імпорт списку квартир">
            <ImportApartments />
          </Panel>
          <Panel title="Коди підтвердження" description="Одноразовий код потрібен мешканцю для самостійної реєстрації.">
            <BulkCodes />
          </Panel>
        </div>

        <Panel title={`Облікові записи (${userRows.length})`}>
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[820px] text-[15px]">
              <thead className="bg-casing text-left text-sm text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Кв.</th>
                  <th className="px-3 py-2.5 font-medium">Прізвище</th>
                  <th className="px-3 py-2.5 font-medium">Пошта</th>
                  <th className="px-3 py-2.5 font-medium">Роль</th>
                  <th className="px-3 py-2.5 font-medium">Останній вхід</th>
                  <th className="px-3 py-2.5 font-medium"><span className="sr-only">Дії</span></th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((u) => (
                  <tr key={u.profile_id} className={`border-t border-line ${u.is_active ? "" : "text-ink-soft"}`}>
                    <td className="px-4 py-2.5 font-semibold">{u.apartment_number ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {u.surname}
                      {!u.is_primary && u.role === "resident" && <span className="ml-1 text-sm text-ink-soft">(додатковий)</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.email}
                      {!u.email_confirmed && <span className="ml-1 text-sm text-warn">не підтверджено</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.role === "admin" ? <Tag tone="face">Адміністратор</Tag> : "Мешканець"}
                      {!u.is_active && <span className="ml-1"><Tag tone="danger">Неактивний</Tag></span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-ink-soft">{formatDateTime(u.last_sign_in_at)}</td>
                    <td className="px-3 py-2.5">
                      <UserActions profileId={u.profile_id} isActive={u.is_active} role={u.role} isSelf={u.auth_user_id === session.userId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

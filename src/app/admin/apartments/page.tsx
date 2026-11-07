import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatReading } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { Button, EmptyState, PageHeader, Panel } from "@/components/ui/controls";
import { Tag } from "@/components/ui/status";
import { ApartmentEditor, BulkCodes, CodeButton, ErasePersonalData, ImportApartments, UserActions } from "@/components/admin/apartments";
import { enterViewAsAction } from "@/app/actions/admin";
import { EntranceFilter, EntranceSelect } from "@/components/admin/entrance-controls";
import { getEntranceMap, matchesEntrance, parseEntranceFilter } from "@/lib/entrance";

export const metadata: Metadata = { title: "Квартири та мешканці" };

type AptRow = {
  id: string;
  apartment_number: string;
  resident_surname: string | null;
  is_active: boolean;
  registration_status: string;
  has_active_code: boolean;
  code_created_at: string | null;
  is_locked: boolean;
  initial_reading: number | null;
  initial_reading_date: string | null;
  accounts_count: number;
};

type ConsentRow = { apartment_id: string; event: "granted" | "withdrawn"; consent_version: string; created_at: string };

type UserRow = {
  profile_id: string;
  auth_user_id: string;
  email: string;
  surname: string | null;
  apartment_number: string | null;
  role: "resident" | "admin";
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
};


export default async function AdminApartmentsPage({ searchParams }: PageProps<"/admin/apartments">) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const entranceFilter = parseEntranceFilter(sp.entrance);
  const supabase = await createClient();
  const [{ data: apts }, { data: users }, entrances, { data: consents }] = await Promise.all([
    supabase.rpc("admin_list_apartments"),
    supabase.rpc("admin_list_users"),
    getEntranceMap(supabase),
    supabase
      .from("personal_data_consents")
      .select("apartment_id, event, consent_version, created_at")
      .not("apartment_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  // Остання подія згоди по кожній квартирі
  const consentByApt = new Map<string, ConsentRow>();
  for (const c of (consents ?? []) as ConsentRow[]) if (!consentByApt.has(c.apartment_id)) consentByApt.set(c.apartment_id, c);
  const allApartments = (apts ?? []) as AptRow[];
  const apartments = allApartments.filter((a) => matchesEntrance(entrances.get(a.id), entranceFilter));
  const entranceCounts = [1, 2, 3].map((n) => allApartments.filter((a) => entrances.get(a.id) === n).length);
  const noEntrance = allApartments.filter((a) => entrances.get(a.id) == null).length;
  const userRows = (users ?? []) as UserRow[];

  return (
    <>
      <PageHeader title="Квартири та мешканці" actions={<ApartmentEditor />} />
      <div className="flex flex-col gap-5">
        <Panel
          title={`Квартири (${entranceFilter ? `${apartments.length} з ${allApartments.length}` : allApartments.length})`}
          description={`Під'їзд 1: ${entranceCounts[0]}, під'їзд 2: ${entranceCounts[1]}, під'їзд 3: ${entranceCounts[2]}${noEntrance ? `, не вказано: ${noEntrance}` : ""}. Під'їзд можна змінити в таблиці — зберігається одразу.`}
          actions={<EntranceFilter />}
        >
          {apartments.length === 0 ? (
            allApartments.length > 0 ? (
              <EmptyState title="Квартир із таким під'їздом немає">Змініть фільтр під&apos;їзду.</EmptyState>
            ) : (
              <EmptyState title="Квартир ще немає">Додайте квартири вручну або імпортуйте список нижче.</EmptyState>
            )
          ) : (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[1100px] text-[15px]">
                <thead className="bg-casing text-left text-sm text-ink-soft">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Кв.</th>
                    <th className="px-3 py-2.5 font-medium">Під&apos;їзд</th>
                    <th className="px-3 py-2.5 font-medium">Прізвище та ім&apos;я</th>
                    <th className="px-3 py-2.5 font-medium">Доступ</th>
                    <th className="px-3 py-2.5 font-medium">Згода на обробку ПД</th>
                    <th className="px-3 py-2.5 text-right font-medium">Початковий показник</th>
                    <th className="px-3 py-2.5 font-medium"><span className="sr-only">Дії</span></th>
                  </tr>
                </thead>
                <tbody>
                  {apartments.map((a) => (
                    <tr key={a.id} className={`border-t border-line ${a.is_active ? "" : "text-ink-soft"}`}>
                      <td className="px-4 py-2.5 font-semibold">{a.apartment_number}</td>
                      <td className="px-3 py-1.5">
                        <EntranceSelect key={`${a.id}-${entrances.get(a.id) ?? ""}`} apartmentId={a.id} number={a.apartment_number} entrance={entrances.get(a.id) ?? null} />
                      </td>
                      <td className="px-3 py-2.5">
                        {a.resident_surname ?? <span className="text-ink-soft">—</span>}
                        {!a.is_active && <span className="ml-2"><Tag>Неактивна</Tag></span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {a.accounts_count > 0 ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <Tag tone="ok">Є код доступу</Tag>
                            {a.code_created_at && <span className="text-sm text-ink-soft">з {formatDateTime(a.code_created_at)}</span>}
                          </span>
                        ) : (
                          <Tag tone="neutral">Немає коду</Tag>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-sm">
                        {(() => {
                          const c = consentByApt.get(a.id);
                          if (!c) return <span className="text-ink-soft">ще не надано</span>;
                          if (c.event === "withdrawn") return <Tag tone="danger">Відкликано {formatDateTime(c.created_at)}</Tag>;
                          return <span>надано {formatDateTime(c.created_at)} <span className="text-ink-soft">(ред. {c.consent_version})</span></span>;
                        })()}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{a.initial_reading === null ? "—" : formatReading(a.initial_reading)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {a.is_active && (
                            <CodeButton
                              apartmentId={a.id}
                              number={a.apartment_number}
                              hasAccess={a.accounts_count > 0}
                              codeSetAt={a.code_created_at}
                            />
                          )}
                          <form action={enterViewAsAction}>
                            <input type="hidden" name="apartmentId" value={a.id} />
                            <Button type="submit" size="sm" variant="ghost">Переглянути</Button>
                          </form>
                          <ApartmentEditor apartment={a} />
                          <ErasePersonalData apartmentId={a.id} number={a.apartment_number} />
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
          <Panel title="Коди доступу" description="Мешканець входить за номером квартири та кодом. Код діє постійно; змінити його можна кнопкою «Змінити код» у таблиці.">
            <BulkCodes />
          </Panel>
        </div>

        <Panel title={`Облікові записи (${userRows.length})`}>
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[820px] text-[15px]">
              <thead className="bg-casing text-left text-sm text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Кв.</th>
                  <th className="px-3 py-2.5 font-medium">Прізвище та ім&apos;я</th>
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
                      {u.surname ?? <span className="text-ink-soft">—</span>}
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

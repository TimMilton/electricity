import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enterViewAsAction } from "@/app/actions/admin";
import { Button, PageHeader, Panel, Select } from "@/components/ui/controls";

export const metadata: Metadata = { title: "Переглянути як мешканець" };

export default async function ViewAsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from("apartments").select("id, apartment_number, resident_surname, sort_num, is_active").order("sort_num").order("apartment_number");
  const apts = (data ?? []) as { id: string; apartment_number: string; resident_surname: string; is_active: boolean }[];
  return (
    <>
      <PageHeader
        title="Переглянути як мешканець"
        description="Відкриває інтерфейс квартири з її показниками, нарахуваннями й статусами. Пароль мешканця не використовується; усі дії записуються від вашого імені."
      />
      <Panel className="max-w-xl">
        <form action={enterViewAsAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Квартира
            <Select name="apartmentId" required>
              {apts.map((a) => (
                <option key={a.id} value={a.id}>
                  №{a.apartment_number}, {a.resident_surname}{a.is_active ? "" : " (неактивна)"}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" className="self-start">Відкрити інтерфейс квартири</Button>
        </form>
      </Panel>
    </>
  );
}

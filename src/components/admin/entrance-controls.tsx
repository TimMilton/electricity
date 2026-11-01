"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { setEntranceAction } from "@/app/actions/resident";
import { Select } from "@/components/ui/controls";

/** Під'їзд квартири в таблиці адміністратора: зміна зберігається одразу (з записом у журнал). */
export function EntranceSelect({ apartmentId, number, entrance }: { apartmentId: string; number: string; entrance: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      aria-label={`Під'їзд квартири ${number}`}
      className="h-9 w-20"
      value={entrance ?? ""}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        const next = v === "" ? null : (Number(v) as 1 | 2 | 3);
        start(async () => {
          const res = await setEntranceAction({ apartmentId, entrance: next });
          if (!res.ok) toast.error(res.error);
          else toast.success(`Кв. ${number}: ${next ? `під'їзд ${next}` : "під'їзд не вказано"}`);
          router.refresh();
        });
      }}
    >
      <option value="">—</option>
      <option value="1">1</option>
      <option value="2">2</option>
      <option value="3">3</option>
    </Select>
  );
}

/** Фільтр за під'їздом для сторінок адміністратора (параметр ?entrance= в адресі). */
export function EntranceFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get("entrance") ?? "";
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      Під&apos;їзд
      <Select
        className="w-44"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set("entrance", e.target.value);
          else next.delete("entrance");
          const qs = next.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname);
        }}
      >
        <option value="">Усі під&apos;їзди</option>
        <option value="1">Під&apos;їзд 1</option>
        <option value="2">Під&apos;їзд 2</option>
        <option value="3">Під&apos;їзд 3</option>
        <option value="none">Не вказано</option>
      </Select>
    </label>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen } from "lucide-react";
import { toast } from "sonner";
import { setEntranceAction } from "@/app/actions/resident";
import { Button } from "@/components/ui/controls";
import { cn } from "@/lib/utils";

const ENTRANCES = [1, 2, 3] as const;

/**
 * Під'їзд квартири на головній сторінці: кнопка «Вкажіть під'їзд» або
 * поточний під'їзд із можливістю змінити. Без apartmentId — лише показ (попередній перегляд).
 */
export function EntrancePicker({ apartmentId, entrance }: { apartmentId?: string; entrance: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [value, setValue] = useState<number | null>(entrance);

  function choose(n: 1 | 2 | 3) {
    if (!apartmentId) return;
    start(async () => {
      const res = await setEntranceAction({ apartmentId, entrance: n });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setValue(n);
      setOpen(false);
      toast.success(res.message ?? "Збережено");
      router.refresh();
    });
  }

  if (!open) {
    return value ? (
      <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-casing px-3 py-1 font-semibold">
          <DoorOpen className="size-4 text-face" aria-hidden />
          Під&apos;їзд {value}
        </span>
        {apartmentId && (
          <button type="button" onClick={() => setOpen(true)} className="text-sm text-face underline underline-offset-4">
            Змінити
          </button>
        )}
      </p>
    ) : (
      <Button
        type="button"
        variant="signal"
        size="sm"
        className="mt-2"
        onClick={() => setOpen(true)}
        disabled={!apartmentId}
      >
        <DoorOpen aria-hidden />
        Вкажіть під&apos;їзд
      </Button>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Оберіть під'їзд">
      <span className="text-[15px] font-medium">Під&apos;їзд:</span>
      {ENTRANCES.map((n) => (
        <Button
          key={n}
          type="button"
          size="sm"
          variant={value === n ? "primary" : "outline"}
          className={cn("min-w-11 tabular")}
          disabled={pending}
          aria-pressed={value === n}
          onClick={() => choose(n)}
        >
          {n}
        </Button>
      ))}
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
        Скасувати
      </Button>
    </div>
  );
}

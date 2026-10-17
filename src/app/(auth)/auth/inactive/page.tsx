import type { Metadata } from "next";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/controls";

export const metadata: Metadata = { title: "Доступ обмежено" };

export default function InactivePage() {
  return (
    <div className="flex flex-col gap-4 pt-6">
      <h1 className="font-display text-3xl font-bold">Доступ обмежено</h1>
      <p className="text-ink-soft">
        Ваш обліковий запис не прив&apos;язаний до активної квартири або деактивований. Зверніться до адміністратора будинку.
      </p>
      <form action={signOutAction}>
        <Button type="submit" variant="outline">Вийти</Button>
      </form>
    </div>
  );
}

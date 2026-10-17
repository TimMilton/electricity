import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/ui/controls";
import { SettingsForm } from "@/components/admin/settings-form";

export const metadata: Metadata = { title: "Налаштування" };

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await getSettings();
  return (
    <>
      <PageHeader title="Налаштування" description={`Оновлено ${formatDateTime(settings.updated_at)}. Тариф і періоди — на сторінці «Періоди й тарифи».`} />
      <SettingsForm settings={settings} />
    </>
  );
}

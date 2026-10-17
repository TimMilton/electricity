"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@supabase/supabase-js";
import { addReceiptsAction, prepareReceiptUploadAction } from "@/app/actions/resident";
import { Button, Notice } from "@/components/ui/controls";

export const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

/** Завантаження файлів у приватний бакет за шляхами, виданими сервером. */
export async function uploadReceiptFiles(paymentId: string, files: File[]): Promise<
  { ok: true; uploads: { path: string; name: string }[] } | { ok: false; error: string }
> {
  const prep = await prepareReceiptUploadAction(
    paymentId,
    files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
  );
  if (!prep.ok) return { ok: false, error: prep.error };
  const { storageUrl, anonKey, uploads } = prep.data!;
  const supabase = createClient(storageUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i]!;
    const { error } = await supabase.storage.from("receipts").uploadToSignedUrl(u.path, u.token, files[i]!, {
      contentType: u.contentType,
      cacheControl: "0",
    });
    if (error) return { ok: false, error: "Не вдалося завантажити файл. Перевірте з'єднання та спробуйте ще раз" };
  }
  return { ok: true, uploads: uploads.map((u) => ({ path: u.path, name: u.name })) };
}

/** Поле вибору файлів квитанції (зручне на смартфоні: камера або галерея). */
export function FilePicker({
  files,
  onChange,
  maxSizeMb,
  id = "receipt",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  maxSizeMb: number;
  id?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          onChange([...files, ...list].slice(0, 5));
          e.target.value = "";
        }}
      />
      <label
        htmlFor={id}
        className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border-2 border-dashed border-line bg-casing/50 px-4 py-5 text-center hover:border-face"
      >
        <Paperclip className="size-5 text-face" aria-hidden />
        <span className="font-semibold text-face">Вибрати файл квитанції</span>
        <span className="text-sm text-ink-soft">PDF, JPEG, PNG або WebP, до {maxSizeMb} МБ. Можна сфотографувати.</span>
      </label>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-casing px-3 py-2 text-[15px]">
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                className="rounded p-1 text-ink-soft hover:bg-white"
                aria-label={`Прибрати ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Додати квитанцію до наявного платежу (модальне вікно). */
export function AddReceiptForm({ paymentId, maxSizeMb, onDone }: { paymentId: string; maxSizeMb: number; onDone?: () => void }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <FilePicker files={files} onChange={setFiles} maxSizeMb={maxSizeMb} id={`add-receipt-${paymentId}`} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button
        type="button"
        disabled={pending || files.length === 0}
        onClick={() =>
          start(async () => {
            setError(null);
            const up = await uploadReceiptFiles(paymentId, files);
            if (!up.ok) return setError(up.error);
            const res = await addReceiptsAction({ paymentId, uploads: up.uploads });
            if (!res.ok) return setError(res.error);
            toast.success("Квитанцію додано");
            setFiles([]);
            router.refresh();
            onDone?.();
          })
        }
      >
        {pending ? "Завантажуємо…" : "Завантажити квитанцію"}
      </Button>
    </div>
  );
}

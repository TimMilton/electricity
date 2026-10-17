"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/types";

/** Виклик серверної дії з повідомленням і оновленням сторінки. */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function run<T>(fn: () => Promise<ActionResult<T>>, opts: { onSuccess?: (r: Extract<ActionResult<T>, { ok: true }>) => void; onConfirm?: (msg: string) => void } = {}) {
    return new Promise<boolean>((resolve) => {
      start(async () => {
        setError(null);
        setFieldErrors({});
        const res = await fn();
        if (!res.ok) {
          if (res.needsConfirmation && opts.onConfirm) {
            opts.onConfirm(res.error);
          } else {
            setError(res.error);
            setFieldErrors(res.fieldErrors ?? {});
            toast.error(res.error);
          }
          resolve(false);
          return;
        }
        if (res.message) toast.success(res.message);
        for (const w of res.warnings ?? []) toast.warning(w, { duration: 10000 });
        opts.onSuccess?.(res);
        router.refresh();
        resolve(true);
      });
    });
  }

  return { run, pending, error, fieldErrors, setError };
}

"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-ink/50" />
      <D.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface shadow-xl",
          "inset-x-0 bottom-0 rounded-t-[var(--radius-panel)]",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-panel)]",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <D.Title className="text-lg font-semibold leading-tight">{title}</D.Title>
            {description && <D.Description className="mt-1 text-sm text-ink-soft">{description}</D.Description>}
          </div>
          <D.Close className="-mr-2 rounded-md p-2 text-ink-soft hover:bg-casing" aria-label="Закрити">
            <X className="size-5" />
          </D.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

/** Діалог підтвердження критичної дії. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  tone = "primary",
  onConfirm,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger" | "ok";
  onConfirm: () => Promise<boolean | void> | boolean | void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const toneClass = { primary: "bg-face hover:bg-face-strong", danger: "bg-danger", ok: "bg-ok" }[tone];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        {children}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose className="h-11 rounded-[var(--radius-control)] border border-line px-4 font-semibold hover:bg-casing">Скасувати</DialogClose>
          <button
            type="button"
            disabled={pending}
            className={cn("h-11 rounded-[var(--radius-control)] px-4 font-semibold text-white disabled:opacity-50", toneClass)}
            onClick={async () => {
              setPending(true);
              try {
                const result = await onConfirm();
                if (result !== false) setOpen(false);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Зачекайте…" : confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

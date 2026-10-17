import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/lib/types";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  awaiting_payment: "Очікує оплати",
  pending_review: "На перевірці",
  paid: "Сплачено",
  rejected: "Оплату не отримано",
};

const PAYMENT_STATUS_STYLE: Record<PaymentStatus, string> = {
  awaiting_payment: "bg-casing text-ink-soft border-line",
  pending_review: "bg-signal-soft text-ink border-signal",
  paid: "bg-ok-soft text-ok border-ok/40",
  rejected: "bg-danger-soft text-danger border-danger/40",
};

export function PaymentStatusBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium",
        PAYMENT_STATUS_STYLE[status],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          status === "paid" && "bg-ok",
          status === "pending_review" && "bg-signal",
          status === "rejected" && "bg-danger",
          status === "awaiting_payment" && "bg-ink-soft/50",
        )}
      />
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "signal" | "face" }) {
  const styles = {
    neutral: "bg-casing text-ink-soft border-line",
    ok: "bg-ok-soft text-ok border-ok/40",
    warn: "bg-warn-soft text-warn border-warn/40",
    danger: "bg-danger-soft text-danger border-danger/40",
    signal: "bg-signal-soft text-ink border-signal",
    face: "bg-face-soft text-face-strong border-face/30",
  }[tone];
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium", styles)}>{children}</span>;
}

/**
 * Показник у вигляді барабанного лічильника: цілі цифри — темні віконця,
 * дробова частина — червоні (як на справжньому лічильнику).
 */
export function MeterDrum({ value, minDigits = 5, className, label }: { value: string | null | undefined; minDigits?: number; className?: string; label?: string }) {
  const text = value ?? "";
  const [intRaw = "", fracRaw = ""] = text.replace(",", ".").split(".");
  const intPart = intRaw === "" ? "–".repeat(minDigits) : intRaw.padStart(minDigits, "0");
  const frac = fracRaw.replace(/0+$/, "");
  return (
    <span className={cn("meter-drum text-2xl sm:text-3xl", className)} role="img" aria-label={label ?? (value ? `Показник ${value}` : "Показник не внесено")}>
      {intPart.split("").map((d, i) => (
        <span key={`i${i}`}>{d}</span>
      ))}
      {frac && (
        <>
          <span className="sep">,</span>
          {frac.split("").map((d, i) => (
            <span key={`f${i}`} className="fraction">
              {d}
            </span>
          ))}
        </>
      )}
    </span>
  );
}

import { ExternalLink, FileText } from "lucide-react";
import type { ReceiptView } from "@/lib/receipts";
import { formatDateTime } from "@/lib/utils";

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** Квитанції з попереднім переглядом. Посилання підписані й діють кілька хвилин. */
export function ReceiptList({ receipts, compact }: { receipts: ReceiptView[]; compact?: boolean }) {
  return (
    <ul className="flex flex-col gap-2">
      {receipts.map((r) => (
        <li key={r.id} className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line p-2">
          {r.url && r.mime_type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.url} alt={`Квитанція ${r.original_filename}`} className="size-14 shrink-0 rounded-md border border-line object-cover" />
          ) : (
            <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-casing text-ink-soft">
              <FileText className="size-6" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">{r.original_filename}</p>
            {!compact && (
              <p className="text-sm text-ink-soft">
                {size(r.file_size)}, {formatDateTime(r.created_at)}
                {r.attempt_no > 0 ? `, спроба ${r.attempt_no}` : ""}
              </p>
            )}
          </div>
          {r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 text-sm font-semibold hover:bg-face-soft"
            >
              <ExternalLink className="size-4" aria-hidden />
              Відкрити
            </a>
          ) : (
            <span className="text-sm text-ink-soft">Недоступно</span>
          )}
        </li>
      ))}
    </ul>
  );
}

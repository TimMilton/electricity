"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { submitPaymentAction } from "@/app/actions/resident";
import { Button, Checkbox, Notice, Panel } from "@/components/ui/controls";
import { ChargeBreakdown } from "@/components/charges";
import { FilePicker, uploadReceiptFiles } from "@/components/receipt-upload";
import { formatMoney, fromDb, toDecimalString } from "@/lib/money";

export type PaymentFlowProps = {
  paymentId: string;
  periodLabel: string;
  amounts: { electricity: string; deposit: string; hallLighting: string; other: string; total: string };
  envelopeUrl: string | null;
  maxSizeMb: number;
  showOther: boolean;
  rejectionReason: string | null;
};

export function PaymentFlow(props: PaymentFlowProps) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Сума для переказу без пробілів і з крапкою — так її приймає банківський застосунок
  const plainTotal = toDecimalString(fromDb(props.amounts.total, 2) ?? 0n, 2);

  if (done) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="size-12 text-ok" aria-hidden />
          <h2 className="font-display text-2xl font-bold">Платіж на перевірці</h2>
          <p className="max-w-[48ch] text-ink-soft">
            Адміністратор перевірить надходження {formatMoney(props.amounts.total)} на конверт і підтвердить оплату. Статус оновиться на головній
            сторінці.
          </p>
          <Button onClick={() => router.push("/home")}>На головну</Button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {props.rejectionReason && (
        <Notice tone="danger" title="Попередню оплату не підтверджено">
          Причина: {props.rejectionReason}. Перевірте переказ і надішліть квитанцію ще раз.
        </Notice>
      )}

      <Panel title={`Ваш платіж за ${props.periodLabel.toLowerCase()}`}>
        <ChargeBreakdown
          electricity={props.amounts.electricity}
          deposit={props.amounts.deposit}
          hallLighting={props.amounts.hallLighting}
          other={props.amounts.other}
          total={props.amounts.total}
          showOther={props.showOther}
        />
      </Panel>

      <Panel title="Крок 1. Переказ на спільний конверт" description="Конверт відкриється в новій вкладці, ця сторінка залишиться відкритою.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[15px] text-ink-soft">Сума до переказу:</span>
            <span className="tabular font-display text-2xl font-bold">{formatMoney(props.amounts.total)}</span>
            <CopyButton value={plainTotal} label="Скопіювати суму" />
          </div>
          {props.envelopeUrl ? (
            <Button asChild variant="signal" size="lg" className="self-start">
              <a href={props.envelopeUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Перейти до конверта
              </a>
            </Button>
          ) : (
            <Notice tone="warn">
              Адміністратор ще не налаштував посилання на конверт. Уточніть у адміністратора, куди переказати кошти.
            </Notice>
          )}
        </div>
      </Panel>

      <Panel title="Крок 2. Квитанція" description="Після переказу прикріпіть квитанцію або скріншот з банківського застосунку.">
        <div className="flex flex-col gap-4">
          <FilePicker files={files} onChange={setFiles} maxSizeMb={props.maxSizeMb} />
          <Checkbox
            label={`Я здійснив оплату ${formatMoney(props.amounts.total)}`}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {error && <Notice tone="danger">{error}</Notice>}
          <Button
            size="lg"
            className="sm:self-start"
            disabled={!confirmed || files.length === 0 || pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const up = await uploadReceiptFiles(props.paymentId, files);
                if (!up.ok) return setError(up.error);
                const res = await submitPaymentAction({ paymentId: props.paymentId, confirmed: true, uploads: up.uploads });
                if (!res.ok) return setError(res.error);
                setDone(true);
                router.refresh();
              })
            }
          >
            {pending ? "Надсилаємо…" : "Надіслати на перевірку"}
          </Button>
          {(!confirmed || files.length === 0) && !pending && (
            <p className="text-sm text-ink-soft">
              {files.length === 0 ? "Виберіть файл квитанції" : "Позначте, що оплату здійснено"}, щоб надіслати платіж на перевірку.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // буфер обміну недоступний (старий браузер) — сума все одно видна на екрані
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Скопійовано" : label}
    </Button>
  );
}

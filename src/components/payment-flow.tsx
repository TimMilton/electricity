"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { submitPaymentAction } from "@/app/actions/resident";
import { Button, Checkbox, Notice, Panel } from "@/components/ui/controls";
import { ChargeBreakdown } from "@/components/charges";
import { FilePicker, uploadReceiptFiles } from "@/components/receipt-upload";
import { formatMoney } from "@/lib/money";

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
  const [step, setStep] = useState<"summary" | "confirm" | "done">("summary");
  const [confirmed, setConfirmed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (step === "done") {
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

      {step === "summary" && (
        <Panel title="Переказ на спільний конверт" description="Конверт відкриється в новій вкладці, ця сторінка залишиться відкритою.">
          {props.envelopeUrl ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="signal" size="lg">
                <a href={props.envelopeUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />
                  Перейти до конверта
                </a>
              </Button>
              <Button size="lg" variant="primary" onClick={() => setStep("confirm")}>
                Продовжити
              </Button>
            </div>
          ) : (
            <>
              <Notice tone="warn">Адміністратор ще не налаштував посилання на конверт. Зверніться до адміністратора.</Notice>
              <Button className="mt-3" variant="outline" onClick={() => setStep("confirm")}>
                Я вже оплатив іншим способом — продовжити
              </Button>
            </>
          )}
        </Panel>
      )}

      {step === "confirm" && (
        <Panel title="Підтвердження оплати" description="Прикріпіть квитанцію або скріншот переказу.">
          <div className="flex flex-col gap-4">
            <Checkbox
              label={`Я здійснив оплату ${formatMoney(props.amounts.total)}`}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <FilePicker files={files} onChange={setFiles} maxSizeMb={props.maxSizeMb} />
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" size="lg" onClick={() => setStep("summary")} disabled={pending}>
                Назад
              </Button>
              <Button
                size="lg"
                disabled={!confirmed || files.length === 0 || pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const up = await uploadReceiptFiles(props.paymentId, files);
                    if (!up.ok) return setError(up.error);
                    const res = await submitPaymentAction({ paymentId: props.paymentId, confirmed: true, uploads: up.uploads });
                    if (!res.ok) return setError(res.error);
                    setStep("done");
                    router.refresh();
                  })
                }
              >
                {pending ? "Надсилаємо…" : "Надіслати на перевірку"}
              </Button>
            </div>
            {(!confirmed || files.length === 0) && (
              <p className="text-sm text-ink-soft">Кнопка стане активною, коли ви позначите оплату та виберете файл квитанції.</p>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

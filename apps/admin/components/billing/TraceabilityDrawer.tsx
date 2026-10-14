"use client";

import Link from "next/link";
import { Dialog } from "@/components/ui/Dialog";
import type {
  AuditEventView,
  InvoiceView,
  PayableView,
  PaymentView,
  ReceivableView,
  TransactionView,
} from "@/lib/types";
import { InvoiceBadge } from "./InvoiceBadge";
import { FinanceBadge } from "../finance/FinanceBadge";
import { formatBRL, formatDateTimeInTZ } from "@/lib/format";

/**
 * Rastreabilidade charge → invoice → receivable → transaction → audit
 * (Fase 4 + Fase 5). Liga o charge Asaas (`externalId`) à fatura local, ao
 * recebível financeiro, ao lançamento realizado e aos eventos de auditoria
 * via `correlationId` propagado (REQUIREMENTS §4, PROJECT §5).
 *
 * Todas as pontas são opcionais: chamadas da Fase 4 (cobranças) exibem só
 * charge → fatura → auditoria; contas a pagar exibem payable → transação →
 * auditoria (sem charge/fatura).
 */
export function TraceabilityDrawer({
  invoice,
  payments = [],
  auditEvents,
  receivable,
  payable,
  transaction,
  onClose,
}: {
  invoice?: InvoiceView | null;
  payments?: PaymentView[];
  auditEvents: AuditEventView[];
  receivable?: ReceivableView | null;
  payable?: PayableView | null;
  transaction?: TransactionView | null;
  onClose: () => void;
}) {
  const title = invoice?.id ?? receivable?.id ?? payable?.id ?? transaction?.id ?? "rastro";
  const correlationId =
    invoice?.correlationId ?? receivable?.correlationId ?? payable?.correlationId ?? transaction?.correlationId ?? "—";
  return (
    <Dialog open onClose={onClose} title={`Rastro ${title}`}>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        <li>
          <strong className="text-headline text-text1">1 · Charge Asaas</strong>
          {invoice ? (
            <div className="font-mono tnum text-[0.85em] text-text2">
              {invoice.provider} ·{" "}
              <code className="font-mono tnum text-[0.85em]">{invoice.externalId}</code>
            </div>
          ) : (
            <p className="m-0 text-callout text-text2">
              Sem charge (lançamento sem fatura — ex.: conta a pagar).
            </p>
          )}
        </li>
        <li>
          <strong className="text-headline text-text1">2 · Fatura local</strong>
          {invoice ? (
            <>
              <div className="text-body text-text1">
                <code className="font-mono tnum text-[0.85em]">{invoice.id}</code> ·{" "}
                {formatBRL(invoice.amount)} · <InvoiceBadge status={invoice.status} />
              </div>
              <div className="text-callout text-text2">
                Vencimento {formatDateTimeInTZ(invoice.dueDate)} · {payments.length} pagamento(s)
              </div>
            </>
          ) : (
            <p className="m-0 text-callout text-text2">Sem fatura vinculada.</p>
          )}
        </li>
        <li>
          <strong className="text-headline text-text1">
            3 · Financeiro (recebível / conta a pagar)
          </strong>
          {receivable ? (
            <div className="text-body text-text1">
              <code className="font-mono tnum text-[0.85em]">{receivable.id}</code> ·{" "}
              {formatBRL(receivable.amount)} · <FinanceBadge status={receivable.status} />
              <div className="text-callout text-text2">
                Vencimento {formatDateTimeInTZ(receivable.dueDate)}
                {receivable.receivedAt ? ` · recebido em ${formatDateTimeInTZ(receivable.receivedAt)}` : ""}
              </div>
            </div>
          ) : payable ? (
            <div className="text-body text-text1">
              <code className="font-mono tnum text-[0.85em]">{payable.id}</code> · {payable.supplier}{" "}
              · {formatBRL(payable.amount)} · <FinanceBadge status={payable.status} />
              <div className="text-callout text-text2">
                Vencimento {formatDateTimeInTZ(payable.dueDate)}
                {payable.paidAt ? ` · pago em ${formatDateTimeInTZ(payable.paidAt)}` : ""}
              </div>
            </div>
          ) : (
            <p className="m-0 text-callout text-text2">
              Sem recebível vinculado (conta ainda não projetada no financeiro).
            </p>
          )}
        </li>
        <li>
          <strong className="text-headline text-text1">4 · Transação realizada</strong>
          {transaction ? (
            <div className="text-body text-text1">
              <code className="font-mono tnum text-[0.85em]">{transaction.id}</code> ·{" "}
              {formatBRL(transaction.amount)} · <FinanceBadge status={transaction.kind} />
              <div className="text-callout text-text2">
                Liquidado em {formatDateTimeInTZ(transaction.settledAt)}
              </div>
            </div>
          ) : (
            <p className="m-0 text-callout text-text2">
              Sem lançamento realizado (único mutador de saldo — REQUIREMENTS §3).
            </p>
          )}
        </li>
        <li>
          <strong className="text-headline text-text1">5 · Auditoria (correlationId)</strong>
          <div>
            <code className="font-mono tnum text-[0.85em] text-text1">{correlationId}</code>
          </div>
          {auditEvents.length === 0 ? (
            <p className="text-callout text-text2">Nenhum evento de auditoria para este correlationId.</p>
          ) : (
            <ul className="m-0 mt-1 flex flex-col gap-1 pl-5 text-body">
              {auditEvents.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/auditoria?correlationId=${encodeURIComponent(e.correlationId)}`}
                    className="text-info hover:underline focus-ring"
                  >
                    {e.action}
                  </Link>{" "}
                  <span className="text-callout text-text2">
                    · {e.actor} · {formatDateTimeInTZ(e.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      </ol>
    </Dialog>
  );
}

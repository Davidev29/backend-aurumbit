"use client";

import { MailWarning, UserCheck, UserPlus, Clock, Ban, Octagon } from "lucide-react";
import { CUSTOMER_STAGE_META } from "@/lib/customers";
import type { CustomerStageFilter, CustomerSummaryCounts } from "@/lib/customers";

/**
 * Funil prospect → cliente.
 *
 * `PROSPECT` nasce no cadastro (e-mail ainda não confirmado) e vira `ACTIVE`
 * (Cliente) na ativação da conta — **sem exigir compra nenhuma**, que é
 * exatamente a regra pedida: quem só criou a conta já é cliente.
 *
 * Cards clicáveis filtram a lista; o card "Todos" volta ao funil completo.
 */
export const STAGE_ICONS = {
  PROSPECT: UserPlus,
  PENDING_PAYMENT: Clock,
  ACTIVE: UserCheck,
  SUSPENDED: Ban,
  CANCELLED: Octagon,
} as const;

export function CustomerFunnel({
  counts,
  selected,
  onSelect,
}: {
  counts: CustomerSummaryCounts;
  selected: CustomerStageFilter | null;
  onSelect: (stage: CustomerStageFilter | null) => void;
}) {
  const cards: Array<{
    stage: CustomerStageFilter | null;
    label: string;
    value: number;
    hint: string;
    tone: string;
    Icon: typeof UserPlus;
  }> = [
    {
      stage: null,
      label: "Todos",
      value: Object.values(counts).reduce((a, b) => a + b, 0),
      hint: "Todos os titulares cadastrados",
      tone: "text-text1",
      Icon: MailWarning,
    },
    {
      stage: "PROSPECT",
      label: CUSTOMER_STAGE_META.PROSPECT.label,
      value: counts.PROSPECT,
      hint: CUSTOMER_STAGE_META.PROSPECT.description,
      tone: "text-info",
      Icon: STAGE_ICONS.PROSPECT,
    },
    {
      stage: "PENDING_PAYMENT",
      label: CUSTOMER_STAGE_META.PENDING_PAYMENT.label,
      value: counts.PENDING_PAYMENT,
      hint: CUSTOMER_STAGE_META.PENDING_PAYMENT.description,
      tone: "text-warn",
      Icon: STAGE_ICONS.PENDING_PAYMENT,
    },
    {
      stage: "ACTIVE",
      label: CUSTOMER_STAGE_META.ACTIVE.label,
      value: counts.ACTIVE,
      hint: CUSTOMER_STAGE_META.ACTIVE.description,
      tone: "text-ok",
      Icon: STAGE_ICONS.ACTIVE,
    },
  ];

  return (
    <div
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      role="group"
      aria-label="Funil de clientes"
    >
      {cards.map(({ stage, label, value, hint, tone, Icon }) => {
        const active = selected === stage;
        return (
          <button
            key={stage ?? "all"}
            type="button"
            onClick={() => onSelect(stage)}
            aria-pressed={active}
            title={hint}
            className={[
              "rounded-card border bg-bg1 p-4 text-left transition-colors focus-ring",
              active ? "border-accent shadow-1" : "border-line1 hover:border-line2",
            ].join(" ")}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-callout font-semibold uppercase tracking-wide text-text2">
                {label}
              </span>
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="text-text3" />
            </span>
            <span className={`mt-1 block font-mono tnum text-title-page font-bold ${tone}`}>{value}</span>
            <span className="mt-1 block text-callout text-text3">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}
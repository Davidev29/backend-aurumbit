"use client";

import { Ban, CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/feedback/ErrorState";
import { getCustomerData } from "./customer-data";
import { CustomerDetailTabs } from "./CustomerDetailTabs";

/**
 * Detalhe do cliente em modal (tamanho `lg`, material `glass` E3 Liquid Glass).
 * Painel translúcido + blur 30px sobre o scrim: a elevação se lê pela sombra
 * L3 em camadas + specular. Esc fecha, foco inicial síncrono, retorno de foco
 * ao gatilho (página). Modal é a única visualização de detalhe (sem página).
 */
export function CustomerDetailModal({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const data = getCustomerData(customerId);

  if (!data) {
    return (
      <Dialog open onClose={onClose} title="Detalhe do cliente" size="md" material="glass" initialFocus="close">
        <ErrorState message="Cliente não encontrado." />
      </Dialog>
    );
  }

  const { customer } = data;
  const initial = customer.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cliente — ${customer.name}`}
      size="lg"
      material="glass"
      footer={
        <Button type="button" variant="secondary" onClick={onClose} title="Fechar detalhe do cliente">
          Fechar
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accentsoft text-headline font-bold text-accent"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-headline font-semibold text-text1">{customer.name}</p>
          <p className="m-0 text-callout text-text2">{customer.email}</p>
        </div>
        <span className="ml-auto shrink-0">
          {customer.status === "active" ? (
            <Badge tone="ok" state="Ativo">
              <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
              Ativo
            </Badge>
          ) : (
            <Badge tone="danger" state="Bloqueado">
              <Ban size={14} strokeWidth={1.75} aria-hidden="true" />
              Bloqueado
            </Badge>
          )}
        </span>
      </div>
      <CustomerDetailTabs customerId={customerId} />
    </Dialog>
  );
}

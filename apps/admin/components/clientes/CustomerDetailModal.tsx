"use client";

import { useState } from "react";
import { Ban, CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Tabs } from "@/components/ui/Tabs";
import { ErrorState } from "@/components/feedback/ErrorState";
import { getCustomerData } from "./customer-data";
import { CustomerDetailTabs, type TabId } from "./CustomerDetailTabs";

/**
 * Detalhe do cliente em modal (tamanho `lg`, material `glass` E3).
 * Layout fixo: título, identidade e abas fixos; só o conteúdo da aba rola
 * internamente — a página atrás nunca rola (trava de `body` no Dialog).
 * Esc fecha, foco inicial síncrono no fechar, retorno de foco ao gatilho
 * (página). Modal é a única visualização de detalhe (sem página).
 */
export function CustomerDetailModal({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>("perfil");
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
  const contractsCount = data.subscriptions.length + data.contracts.length;
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "perfil", label: "Perfil" },
    {
      id: "contratos",
      label: contractsCount > 0 ? `Contratos (${contractsCount})` : "Contratos",
    },
    {
      id: "licencas",
      label: data.licenses.length > 0 ? `Licenças (${data.licenses.length})` : "Licenças",
    },
    {
      id: "acessos",
      label: data.sessions.length > 0 ? `Acessos (${data.sessions.length})` : "Acessos",
    },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cliente — ${customer.name}`}
      size="lg"
      material="glass"
      initialFocus="close"
      fixedContent={
        <>
          <div className="flex items-center gap-3 mb-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accentsoft text-body font-bold text-accent"
            >
              {initial}
            </span>
            <div className="min-w-0">
              <p className="m-0 truncate text-body font-semibold text-text1">{customer.name}</p>
              <p className="m-0 truncate text-callout text-text2">{customer.email}</p>
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
          <Tabs tabs={tabs} value={tab} onChange={setTab} label="Seções do cliente" />
        </>
      }
      footer={
        <Button type="button" variant="secondary" onClick={onClose} title="Fechar detalhe do cliente">
          Fechar
        </Button>
      }
    >
      <CustomerDetailTabs customerId={customerId} tab={tab} />
    </Dialog>
  );
}

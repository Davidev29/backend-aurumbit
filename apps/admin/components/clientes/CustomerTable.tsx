"use client";

import { Ban, CircleCheck, Eye } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TR, Table, Td, Th } from "@/components/ui/table";
import { CUSTOMER_STAGE_META, stageAgeLabel } from "@/lib/customers";
import type { CustomerStageFilter } from "@/lib/customers";
import type { CustomerRow, FunnelCustomerRow } from "./customer-data";
import { STAGE_ICONS } from "./CustomerFunnel";

/**
 * Tabela enxuta de clientes (DS §9: sem zebra, hover sutil).
 * Colunas: cliente (avatar + nome + e-mail), situação no funil (prospect ou
 * cliente), acesso (licença ativa/bloqueada), licenças e ações em
 * botões-ícone discretos. Produto não é coluna (escala p/ N produtos) —
 * filtra-se por produto na barra de filtros; o vínculo vive no modal.
 *
 * `stage` (funil comercial) e `status` (acesso/licença) são eixos diferentes
 * e ficam em colunas diferentes de propósito: um prospect ainda não tem
 * licença para bloquear, e um cliente pode ter o acesso suspenso.
 */
export function CustomerTable({
  rows,
  selectedId,
  onOpen,
  onToggleBlock,
  canToggleBlock,
}: {
  /** Aceita a row do funil (BFF) e a row legada de `customer-data`. */
  rows: Array<CustomerRow | FunnelCustomerRow>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onToggleBlock: (row: CustomerRow | FunnelCustomerRow) => void;
  canToggleBlock: boolean;
}) {
  return (
    <Table
      caption="Lista de clientes com status e gestão"
      head={
        <>
          <Th>Cliente</Th>
          <Th>Situação</Th>
          <Th>Acesso</Th>
          <Th numeric>Licenças</Th>
          <Th className="text-right">Ações</Th>
        </>
      }
    >
      {rows.map((c) => {
        const blocked = c.status === "blocked";
        const initial = c.name.trim().charAt(0).toUpperCase() || "?";
        const stage: CustomerStageFilter = c.stage ?? "PROSPECT";
        const stageMeta = CUSTOMER_STAGE_META[stage];
        const StageIcon = STAGE_ICONS[stage];
        const age = stageAgeLabel(c.stageChangedAt ?? c.createdAt);
        return (
          <TR key={c.id} selected={selectedId === c.id}>
            <Td>
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentsoft text-callout font-bold text-accent"
                >
                  {initial}
                </span>
                <span className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    title={`Ver detalhes de ${c.name}`}
                    aria-haspopup="dialog"
                    className="block max-w-[13rem] truncate bg-transparent border-0 p-0 cursor-pointer text-left text-body font-medium text-info hover:underline focus-ring"
                  >
                    {c.name}
                  </button>
                  <span className="block max-w-[13rem] truncate text-callout text-text2" title={c.email}>
                    {c.email}
                  </span>
                </span>
              </span>
            </Td>
            <Td>
              {/* Funil comercial (prospect → cliente) */}
              <Badge tone={stageMeta.tone} state={stageMeta.label}>
                <StageIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                {stageMeta.label}
                {age ? ` · ${age}` : ""}
              </Badge>
              {!c.emailVerified && (
                <span className="mt-1 block text-callout text-text3">E-mail não confirmado</span>
              )}
            </Td>
            <Td>
              {blocked ? (
                <Badge tone="danger" state="Bloqueado">
                  <Ban size={14} strokeWidth={1.75} aria-hidden="true" />
                  Bloqueado
                </Badge>
              ) : (
                <Badge tone="ok" state="Ativo">
                  <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
                  Ativo
                </Badge>
              )}
            </Td>
            <Td numeric>{c.licensesCount}</Td>
            <Td className="text-right">
              <span className="inline-flex items-center justify-end gap-1">
                <Button
                  id={`cliente-${c.id}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  onClick={() => onOpen(c.id)}
                  title={`Ver detalhes de ${c.name}`}
                  aria-label={`Ver detalhes de ${c.name}`}
                  aria-haspopup="dialog"
                >
                  <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  onClick={() => onToggleBlock(c)}
                  disabled={!canToggleBlock}
                  title={
                    !canToggleBlock
                      ? "Requer permissão license.adjust"
                      : blocked
                        ? `Liberar acesso de ${c.name}`
                        : `Bloquear acesso de ${c.name}`
                  }
                  aria-label={
                    blocked ? `Liberar acesso de ${c.name}` : `Bloquear acesso de ${c.name}`
                  }
                >
                  {blocked ? (
                    <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <Ban size={16} strokeWidth={1.75} aria-hidden="true" />
                  )}
                </Button>
              </span>
            </Td>
          </TR>
        );
      })}
    </Table>
  );
}

"use client";

import { useState } from "react";
import { Ban, Check, CircleCheck, Copy, Eye, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useCan } from "@/lib/auth/permissions";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { mockCustomerDetail, mockCustomerPage } from "@/lib/mocks";
import type { CustomerDetail, CustomerSummary } from "@/lib/types";
import { CustomerDetailModal } from "@/components/clientes/CustomerDetailModal";
import { PreRegisterDialog, type PreRegistered } from "@/components/clientes/PreRegisterDialog";

export default function ClientesPage() {
  const canCreate = useCan("customer.read");
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preOpen, setPreOpen] = useState(false);
  const [created, setCreated] = useState<CustomerDetail[]>([]);
  const [fresh, setFresh] = useState<PreRegistered | null>(null);
  const [copied, setCopied] = useState(false);

  // TODO(backend pronto): cursor pagination real via `apiGet("/v1/customers…")`
  // + `POST /v1/customers` p/ o pré-cadastro (hoje em sessão).
  const page = mockCustomerPage(debounced, null);
  const q = debounced.toLowerCase();
  const rows: CustomerSummary[] = [
    ...created.filter((c) => c.name.toLowerCase().includes(q)),
    ...page.data,
  ];
  const takenEmails = [
    ...page.data
      .map((c) => mockCustomerDetail(c.id)?.email.toLowerCase())
      .filter((e): e is string => !!e),
    ...created.map((c) => c.email.toLowerCase()),
  ];

  function openCustomer(id: string) {
    setSelectedId(id);
  }

  function closeCustomer() {
    const id = selectedId;
    setSelectedId(null);
    // Retorno de foco ao gatilho (DS §6: foco síncrono, nunca pós-animação).
    if (id) {
      requestAnimationFrame(() => {
        document.getElementById(`cliente-${id}`)?.focus();
      });
    }
  }

  async function copySetupLink() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.setupLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      /* clipboard indisponível — link segue selecionável */
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-title-page text-text1">Clientes</h1>
        <Button
          type="button"
          variant="primary"
          onClick={() => setPreOpen(true)}
          disabled={!canCreate}
          title={canCreate ? "Pré-cadastrar cliente (conta e/ou produto)" : "Requer permissão de leitura de clientes"}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Pré-cadastrar cliente
        </Button>
      </div>

      {fresh && (
        <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
          <p className="m-0 text-body text-text1">
            <Badge tone="ok" state="Conta criada">Conta criada</Badge>{" "}
            {fresh.customer.name}
            {fresh.product ? ` · produto ${fresh.product}` : " · somente conta"} · trilha{" "}
            <span className="font-mono tnum text-[0.85em]">{fresh.auditId}</span>
          </p>
          <p className="mb-2 mt-2 text-callout text-text2">
            Link de definição de senha (demonstração — expira; o backend envia por e-mail):
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-base border border-line1 bg-bg2 p-2 font-mono tnum text-callout text-text1">
              {fresh.setupLink}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={copySetupLink}
              title="Copiar link de definição de senha"
              aria-live="polite"
            >
              {copied ? (
                <Check size={16} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      )}

      <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4">
        <div className="max-w-[24rem]">
          <Field label="Buscar por nome" htmlFor="busca-clientes">
            <Input
              id="busca-clientes"
              type="search"
              placeholder="Ex.: Alice"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
        </div>
        <p className="m-0 text-callout text-text2">
          Selecione um cliente para ver perfil, contratos, licenças e diagnóstico em modal.
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nenhum cliente encontrado" message="Ajuste a busca ou pré-cadastre um novo cliente." />
      ) : (
        <Table
          caption="Lista de clientes"
          head={
            <>
              <Th>Nome</Th>
              <Th>Documento</Th>
              <Th>Status</Th>
              <Th numeric>Licenças</Th>
              <Th>Detalhe</Th>
            </>
          }
        >
          {rows.map((c) => (
            <tr key={c.id}>
              <Td>
                <button
                  id={`cliente-${c.id}`}
                  type="button"
                  onClick={() => openCustomer(c.id)}
                  title={`Ver detalhes de ${c.name}`}
                  aria-haspopup="dialog"
                  className="inline-flex min-h-[44px] items-center bg-transparent border-0 p-0 cursor-pointer text-left text-body text-info hover:underline focus-ring"
                >
                  {c.name}
                </button>
              </Td>
              <Td mono>{c.docMasked}</Td>
              <Td>
                {c.status === "active" ? (
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
              </Td>
              <Td numeric>{c.licensesCount}</Td>
              <Td>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => openCustomer(c.id)}
                  title={`Ver detalhes de ${c.name}`}
                  aria-label={`Ver detalhes de ${c.name}`}
                  aria-haspopup="dialog"
                >
                  <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                  Abrir
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {selectedId && <CustomerDetailModal customerId={selectedId} onClose={closeCustomer} />}
      {preOpen && (
        <PreRegisterDialog
          takenEmails={takenEmails}
          onClose={() => setPreOpen(false)}
          onDone={(entry) => {
            setCreated((list) => [entry.customer, ...list]);
            setFresh(entry);
            setCopied(false);
          }}
        />
      )}
    </div>
  );
}

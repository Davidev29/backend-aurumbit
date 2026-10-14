"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/Button";
import { Field, Input, PasswordInput } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { Table, Th, Td, Pager, EmptyState, ErrorState } from "@/components/ui/table";
import { Dialog, DestructiveConfirm } from "@/components/ui/Dialog";

/**
 * Vitrine interativa do Aurum DS v1 (`docs/design-system/DS.md`).
 * Rota de trabalho — não expõe dados reais.
 */
export default function DsPage() {
  const { theme, toggle } = useTheme();
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [code, setCode] = useState("");

  return (
    <div className="min-h-screen bg-bg0 text-text1 p-6">
      <div className="max-w-[960px] mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-micro text-text2 m-0 uppercase tracking-wide">Aurum DS v1 · regras travadas</p>
            <h1 className="text-title-page m-0">Vitrine interativa</h1>
          </div>
          <Button variant="secondary" onClick={toggle} title="Alternar tema">
            {theme === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
            {theme === "dark" ? "Claro" : "Escuro"}
          </Button>
        </header>

        <section className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
          <h2 className="text-section mt-0">Botões</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Primário</Button>
            <Button variant="secondary">Secundário</Button>
            <Button variant="destructive">Excluir</Button>
            <Button variant="ghost">Fantasma</Button>
            <Button variant="primary" size="sm" title="Ação compacta (uso restrito)">
              Pequeno
            </Button>
          </div>
        </section>

        <section className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
          <h2 className="text-section mt-0">Selos</h2>
          <div className="flex flex-wrap gap-2">
            <Badge>neutro</Badge>
            <Badge tone="ok">pago</Badge>
            <Badge tone="warn">pendente</Badge>
            <Badge tone="danger">vencido</Badge>
            <Badge tone="info">info</Badge>
            <Badge tone="accent">destaque</Badge>
          </div>
        </section>

        <section className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
          <h2 className="text-section mt-0">Campos</h2>
          <Field label="E-mail" hint="Usado para login e cobrança.">
            <Input type="email" placeholder="voce@empresa.com.br" />
          </Field>
          <Field label="Senha" error={undefined}>
            <PasswordInput placeholder="••••••••" />
          </Field>
          <Field label="Código MFA" hint="6 dígitos, envio automático.">
            <Input
              mono
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-mfa-code"
              placeholder="••••••"
            />
          </Field>
          <Field label="Valor (mono + tabular)" hint="Números sempre tabulares, coluna à direita.">
            <Input mono defaultValue="R$ 1.234,56" />
          </Field>
        </section>

        <section className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
          <h2 className="text-section mt-0">Tabela + paginação</h2>
          <Table
            head={
              <>
                <Th>Fatura</Th>
                <Th>Status</Th>
                <Th numeric>Valor</Th>
              </>
            }
          >
            <tr>
              <Td mono>INV-2026-000123</Td>
              <Td>
                <Badge tone="ok">paga</Badge>
              </Td>
              <Td numeric>R$ 499,00</Td>
            </tr>
            <tr>
              <Td mono>INV-2026-000124</Td>
              <Td>
                <Badge tone="warn">pendente</Badge>
              </Td>
              <Td numeric>R$ 1.199,90</Td>
            </tr>
          </Table>
          <Pager hasPrev={false} hasNext status="Página 1 · cursor abc123" onPrev={() => {}} onNext={() => {}} />
        </section>

        <section className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
          <h2 className="text-section mt-0">Diálogos</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog(true)}>
              Abrir diálogo
            </Button>
            <Button variant="destructive" onClick={() => setConfirm(true)}>
              Excluir item…
            </Button>
          </div>
        </section>

        <section className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
          <h2 className="text-section mt-0">Estados</h2>
          <EmptyState title="Nenhuma cobrança" hint="Crie a primeira fatura para começar." />
          <ErrorState message="Falha ao carregar. Tente de novo." onRetry={() => {}} />
        </section>

        <Dialog open={dialog} onClose={() => setDialog(false)} title="Exemplo de diálogo">
          <p className="text-body text-text2">Tamanho único, foco inicial no fechar, Escape fecha, scrim sem blur.</p>
        </Dialog>
        <DestructiveConfirm
          open={confirm}
          onClose={() => setConfirm(false)}
          onConfirm={() => setConfirm(false)}
          title="Excluir item?"
          description="Ação em 2 passos: confirme para excluir definitivamente."
        />
      </div>
    </div>
  );
}

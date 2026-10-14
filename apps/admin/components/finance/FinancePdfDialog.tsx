"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { useCan, useMe } from "@/lib/auth/permissions";
import { listPayables, listReceivables, listTransactions } from "@/lib/finance";
import { buildFinanceReportHtml, type FinanceReportKind, type FinanceReportRow } from "@/lib/finance-report";
import { useToast } from "@/lib/toast";

async function fetchAllReceivables() {
  const out: Awaited<ReturnType<typeof listReceivables>>["data"] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 25; i += 1) {
    const page = await listReceivables(
      { status: null, category: null, product: null, from: null, to: null },
      cursor,
    );
    out.push(...page.data);
    if (!page.meta.nextCursor) break;
    cursor = page.meta.nextCursor;
  }
  return out;
}

async function fetchAllPayables() {
  const out: Awaited<ReturnType<typeof listPayables>>["data"] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 25; i += 1) {
    const page = await listPayables(
      { status: null, category: null, product: null, from: null, to: null },
      cursor,
    );
    out.push(...page.data);
    if (!page.meta.nextCursor) break;
    cursor = page.meta.nextCursor;
  }
  return out;
}

async function fetchAllTransactions() {
  const out: Awaited<ReturnType<typeof listTransactions>>["data"] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 25; i += 1) {
    const page = await listTransactions(
      { kind: null, status: null, category: null, product: null, from: null, to: null },
      cursor,
    );
    out.push(...page.data);
    if (!page.meta.nextCursor) break;
    cursor = page.meta.nextCursor;
  }
  return out;
}

function inPeriod(iso: string, de: string, ate: string): boolean {
  const day = iso.slice(0, 10);
  if (de && day < de) return false;
  if (ate && day > ate) return false;
  return true;
}

/**
 * Relatório customizado em PDF (empresarial/editorial).
 * - Escopo: somente receitas, somente despesas OU extrato completo
 *   (entradas + saídas) no período;
 * - Período: `de`/`ate` (vencimento p/ receitas/despesas, liquidação p/ extrato);
 * - Saída: documento com logomarca (`/brand/logo.png`), margens A4, tabelas
 *   legíveis, entradas em verde e saídas em vermelho — impresso via
 *   `window.print()` → "Salvar como PDF".
 * Exige `finance.manage` (mesma regra do CSV).
 */
export function FinancePdfDialog({ onClose }: { onClose: () => void }) {
  const { me } = useMe();
  const { notify } = useToast();
  const [kind, setKind] = useState<FinanceReportKind>("receitas");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (pending || !acknowledged) return;
    setPending(true);
    setError(null);
    try {
      let rows: FinanceReportRow[] = [];
      if (kind === "extrato") {
        const all = await fetchAllTransactions();
        rows = all
          .filter((t) => inPeriod(t.settledAt, de, ate))
          .sort((a, b) => (a.settledAt < b.settledAt ? -1 : 1))
          .map((t) => ({
            data: t.settledAt,
            titulo: t.description,
            categoria: t.category,
            estado: t.kind === "RECEITA" ? "RECEBIDA" : "PAGA",
            valor: t.amount,
            direcao: (t.kind === "RECEITA" ? "entrada" : "saida") as FinanceReportRow["direcao"],
          }));
      } else if (kind === "receitas") {
        const all = await fetchAllReceivables();
        rows = all
          .filter((r) => inPeriod(r.dueDate, de, ate))
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
          .map((r) => ({
            data: r.dueDate,
            titulo: r.customerName,
            categoria: r.category,
            estado: r.status,
            valor: r.amount,
          }));
      } else {
        const all = await fetchAllPayables();
        rows = all
          .filter((p) => inPeriod(p.dueDate, de, ate))
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
          .map((p) => ({
            data: p.dueDate,
            titulo: p.supplier,
            categoria: p.category,
            estado: p.status,
            valor: p.amount,
          }));
      }

      const html = buildFinanceReportHtml({
        kind,
        de,
        ate,
        rows,
        geradoPor: me?.email || me?.name || "Terminal administrativo",
      });
      const win = window.open("", "_blank", "width=1024,height=768");
      if (!win) {
        throw new Error("O navegador bloqueou a janela do relatório. Permita pop-ups e tente de novo.");
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      // Aguarda o logo renderizar antes de abrir o diálogo de impressão/PDF.
      win.onload = () => {
        win.setTimeout(() => {
          win.print();
        }, 350);
      };
      notify("success", "Relatório gerado", `${rows.length} ${rows.length === 1 ? "registro" : "registros"} · use “Salvar como PDF”.`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao gerar relatório.";
      setError(msg);
      notify("error", "Falha no relatório PDF", msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Relatório customizado em PDF"
      pending={pending}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Voltar
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!acknowledged || pending}
            title={!acknowledged ? "Confirme para gerar o relatório" : "Gerar PDF"}
            onClick={handleGenerate}
          >
            {pending ? "Gerando…" : "Gerar PDF"}
          </Button>
        </>
      }
    >
      <p className="mt-0 text-body text-text2">
        Escolha o escopo e o período. Receitas/despesas filtram pelo vencimento; o extrato completo traz entradas +
        saídas pela data de liquidação, com destaque visual verde/vermelho. O documento sai com logomarca Aurum Bit,
        margens A4 e botão de impressão.
      </p>
      <div className="grid gap-3" role="radiogroup" aria-label="Escopo do relatório">
        {(
          [
            { id: "receitas", title: "Somente receitas", hint: "Recebíveis no período (vencimento)" },
            { id: "despesas", title: "Somente despesas", hint: "Contas a pagar no período (vencimento)" },
            { id: "extrato", title: "Entradas + saídas (extrato)", hint: "Todos os lançamentos liquidados no período" },
          ] as const
        ).map((o) => (
          <label
            key={o.id}
            className={`flex cursor-pointer items-center gap-3 rounded-card border p-3 text-body ${
              kind === o.id ? "border-accent bg-accentsoft" : "border-line2 bg-bg2"
            }`}
          >
            <input
              type="radio"
              name="pdf-kind"
              value={o.id}
              checked={kind === o.id}
              onChange={() => setKind(o.id)}
              className="h-5 w-5 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            <span>
              <span className="block font-semibold text-text1">{o.title}</span>
              <span className="block text-callout text-text2">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="De" htmlFor="pdf-de">
          <Input id="pdf-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="pdf-ate">
          <Input id="pdf-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <label htmlFor="pdf-confirm" className="flex items-center gap-2 text-callout text-text2">
          <input
            id="pdf-confirm"
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="h-5 w-5 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          Confirmo a geração do relatório (uso interno, valores em BRL)
        </label>
      </div>
      {error && (
        <p className="mt-3 text-callout text-danger" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function FinancePdfButton() {
  const canExport = useCan("finance.manage");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={!canExport}
        title={canExport ? "Gerar relatório customizado em PDF (receitas, despesas ou extrato no período)" : "Requer permissão finance.manage"}
        onClick={() => setOpen(true)}
      >
        <FileDown size={20} strokeWidth={1.75} aria-hidden="true" />
        Relatório PDF
      </Button>
      {open && <FinancePdfDialog onClose={() => setOpen(false)} />}
    </>
  );
}

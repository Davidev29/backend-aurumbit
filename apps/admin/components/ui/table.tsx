"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import {
  EmptyState as FeedbackEmptyState,
  type EmptyStateProps as FeedbackEmptyStateProps,
} from "@/components/feedback/EmptyState";
import { ErrorState as FeedbackErrorState } from "@/components/feedback/ErrorState";

/**
 * Tabela DS v1 (DS §9): sem zebra, hover sutil, `th` 12.5px/700 uppercase,
 * selecionada em dourado, numérico à direita mono `tabular-nums` sem truncar.
 * `caption` obrigatória (aviso em dev quando ausente).
 *
 * API nova (`head` + `Th/Td`) + compat legada
 * (`THead/TBody/TR/TH/TD`, `<Table caption>` sem `head`).
 */

export function Table({
  head,
  children,
  caption,
}: {
  head?: ReactNode;
  children: ReactNode;
  caption?: string;
}) {
  if (process.env.NODE_ENV !== "production" && !caption) {
    // eslint-disable-next-line no-console
    console.warn("[Aurum DS] Table sem `caption` — caption é obrigatória (acessibilidade + contexto).");
  }
  return (
    <div className="overflow-x-auto rounded-card border border-line1 bg-bg1">
      <table className="w-full border-collapse text-body">
        {caption && <caption className="text-left p-3 text-callout text-text2">{caption}</caption>}
        {head && (
          <thead>
            <tr className="bg-bg2">{head}</tr>
          </thead>
        )}
        {head ? (
          <tbody className="[&>tr]:border-b [&>tr]:border-line1 [&>tr:last-child]:border-b-0 [&>tr:hover]:bg-bg2">
            {children}
          </tbody>
        ) : (
          children
        )}
      </table>
    </div>
  );
}

export function Th({
  children,
  numeric,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "p-3 text-[12.5px] font-bold uppercase tracking-wide text-text2",
        numeric ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  mono,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "p-3 text-text1",
        numeric || mono
          ? "text-right font-mono text-[0.85em] tnum whitespace-nowrap"
          : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Compat legada — mesma estilização, nomes antigos. */
export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="bg-bg2">{children}</tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return (
    <tbody className="[&>tr]:border-b [&>tr]:border-line1 [&>tr:last-child]:border-b-0 [&>tr:hover]:bg-bg2">
      {children}
    </tbody>
  );
}

export function TR({
  children,
  selected,
  className,
  ...props
}: {
  children: ReactNode;
  /** Linha selecionada: destaque dourado (`--accent-soft`). */
  selected?: boolean;
} & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(selected && "bg-accentsoft", className)}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TH({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={
        className ??
        "p-3 text-left text-[12.5px] font-bold uppercase tracking-wide text-text2"
      }
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const mono = className?.includes("mono") ?? false;
  return (
    <td
      className={
        mono
          ? "p-3 text-right font-mono text-[0.85em] tnum whitespace-nowrap text-text1"
          : cn("p-3 text-text1", className)
      }
    >
      {children}
    </td>
  );
}

/**
 * Paginação por cursor (DS §9): Anterior/Próxima, nunca numerada.
 * Botões sempre renderizados (desabilitados na borda — estabilidade de layout).
 * `reset()` deve ser chamado em TODA mudança de filtro (ver `useCursorPager`).
 */
export function Pager({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  status,
}: {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  status?: string;
}) {
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 mt-3">
      <p className="text-callout text-text2 m-0">{status ?? ""}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onPrev}
          disabled={!hasPrev}
          title={!hasPrev ? "Sem página anterior" : "Página anterior"}
        >
          Anterior
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onNext}
          disabled={!hasNext}
          title={!hasNext ? "Sem próxima página" : "Próxima página"}
        >
          Próxima
        </Button>
      </div>
    </nav>
  );
}

/**
 * Histórico de cursor p/ paginação (DS §9). Uso:
 * `const pg = useCursorPager(); listX(filters, pg.cursor)` +
 * `<Pager … onPrev={pg.prev} onNext={…pg.next} />` + `pg.reset()` nos filtros.
 * `Pager` retorna `null` se `!page || data.length === 0` (responsabilidade da página).
 */
export function useCursorPager() {
  const [history, setHistory] = useState<Array<string | null>>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const cursor = history[pageIdx] ?? null;
  function reset() {
    setHistory([null]);
    setPageIdx(0);
  }
  function prev() {
    setPageIdx((i) => Math.max(0, i - 1));
  }
  function next(nextCursor: string) {
    setHistory((h) => [...h.slice(0, pageIdx + 1), nextCursor]);
    setPageIdx((i) => i + 1);
  }
  return { cursor, pageIdx, history, reset, prev, next };
}

/**
 * Estados dedicados de tabela (DS §9): vazio / erro.
 * Compat: aceita `hint` (legado `ui/table`) ou `message`/`action` (feedback).
 * Tabela vazia nunca renderiza armadura vazia — retorne `<EmptyState>`.
 */
export function EmptyState({
  title,
  hint,
  message,
  action,
}: {
  title: string;
  hint?: string;
  message?: FeedbackEmptyStateProps["message"];
  action?: FeedbackEmptyStateProps["action"];
}) {
  return <FeedbackEmptyState title={title} message={message ?? hint} action={action} />;
}

export { FeedbackErrorState as ErrorState };

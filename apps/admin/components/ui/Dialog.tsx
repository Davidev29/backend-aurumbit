"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { backdropVar, fadeScale } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

type DialogSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: "max-w-[24rem]",
  md: "max-w-[36rem]",
  lg: "max-w-[48rem]",
  xl: "max-w-[64rem]",
};

/**
 * Dialog DS v1 (DS §9): header/body/footer, foco inicial síncrono,
 * Esc, backdrop scrim (sem blur), trava em `pending`.
 * Tamanho único padrão `md`; `sm` p/ confirmações curtas, `lg` p/ rastro/detalhe,
 * `xl` p/ detalhe rico do cliente (tabela + abas confortáveis em desktop).
 *
 * Anatomia: `h2` (verbo + objeto) → contexto `.muted` → `form` →
 * erro de submit `.form-error[role=alert]` → `.dialog-actions` no footer.
 *
 * Conforto: painel com `max-h-[85vh]` + scroll interno (`overscroll-contain`)
 * para que listas densas rolem dentro do modal sem empurrar o backdrop;
 * transições `fadeScale` (240ms entrada / 180ms saída, só transform+opacity).
 */
export function Dialog({
  open,
  onClose,
  title,
  titleId: titleIdProp,
  size = "md",
  material = "opaque",
  children,
  footer,
  pending,
  initialFocus = "first-field",
  fixedContent,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Compat (`licencas/Modal`): prefixo do `id` do título. */
  titleId?: string;
  size?: DialogSize;
  /**
   * Material do painel: `opaque` (padrão DS §2 — fundo sólido + scrim) ou
   * `glass` (E3 Liquid Glass: surface-2 translúcido + blur 30px + sombra L3
   * em camadas; exceção aprovada p/ os modais da seção de clientes).
   */
  material?: "opaque" | "glass";
  children: React.ReactNode;
  footer?: React.ReactNode;
  pending?: boolean;
  /** Foco inicial síncrono (nunca pós-animação): primeiro campo ou fechar. */
  initialFocus?: "first-field" | "close";
  /**
   * Faixa fixa entre o título e o corpo (ex.: identidade + abas do detalhe).
   * Quando presente, o painel usa layout fixo — título, faixa e rodapé fixos,
   * só o corpo rola internamente (`overflow-y-auto`); a página atrás nunca
   * rola (trava de `body`). Sem `fixedContent`, o painel inteiro rola.
   */
  fixedContent?: React.ReactNode;
}) {
  const autoTitleId = useId();
  const titleId = titleIdProp ?? `dialog-title-${autoTitleId}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Foco síncrono no mount (DS §6) — primeiro campo, senão o fechar.
    if (initialFocus === "first-field") {
      const field = panelRef.current?.querySelector<HTMLElement>(
        "[data-autofocus], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
      );
      (field ?? closeRef.current)?.focus();
    } else {
      closeRef.current?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Trava o scroll da página atrás do modal (só o corpo interno rola).
    // Salva/restaura (pilha segura p/ diálogos aninhados).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, pending, initialFocus]);

  const fixed = fixedContent !== undefined && fixedContent !== null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={backdropVar}
          initial="hidden"
          animate="show"
          exit="exit"
          className={cn(
            "fixed inset-0 z-50 flex justify-center px-4",
            fixed ? "items-center py-4 overflow-hidden" : "items-start pt-[15vh] pb-4 overflow-y-auto",
          )}
          style={{ background: "var(--scrim)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            variants={fadeScale}
            initial="hidden"
            animate="show"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn(
              "w-full rounded-modal p-5 overscroll-contain",
              fixed
                ? "flex flex-col overflow-hidden h-[84vh] max-h-[920px] min-h-[420px]"
                : "max-h-[85vh] overflow-y-auto",
              SIZE_CLASS[size],
              material === "glass"
                ? "glass-modal"
                : "bg-bg1 border border-line1 shadow-3",
            )}
          >
            <div className="flex items-start justify-between gap-3 mb-3 shrink-0">
              <h2 id={titleId} className="text-section m-0 text-text1">
                {title}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                disabled={pending}
                title={pending ? "Aguarde…" : "Fechar diálogo"}
                aria-label="Fechar diálogo"
                className="w-11 h-11 -m-2 inline-flex items-center justify-center rounded-base text-text2 hover:text-text1 disabled:opacity-45 disabled:cursor-not-allowed focus-ring"
              >
                <X size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            {fixed && <div className="shrink-0 border-b border-line1 pb-3 mb-3">{fixedContent}</div>}
            {fixed ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">{children}</div>
            ) : (
              <div>{children}</div>
            )}
            {footer && (
              <div
                className={cn(
                  "flex gap-2 justify-end",
                  fixed ? "shrink-0 border-t border-line1 pt-3 mt-3" : "mt-4",
                )}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Confirmação curta sem motivo (2 estados inline). P/ ações auditadas use `DestructiveForm`. */
export function DestructiveConfirm({
  open,
  onClose,
  onConfirm,
  title,
  description,
  pending,
  confirmLabel = "Confirmar exclusão",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  pending?: boolean;
  confirmLabel?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      pending={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending} title={pending ? "Aguarde…" : "Voltar"}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            loading={pending}
            loadingLabel="Excluindo…"
            title={pending ? "Excluindo…" : confirmLabel}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={cn("text-body text-text2 m-0")}>{description}</p>
    </Dialog>
  );
}

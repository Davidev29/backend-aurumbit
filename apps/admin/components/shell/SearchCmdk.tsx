"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

/** Busca global — stub v1: trigger "Buscar… Ctrl+K" + dialog md opaco sem footer (sem Command-K completo). */
export function SearchCmdk() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [open ]);

  // Esc fecha e devolve o foco ao trigger (foco síncrono, DS §6).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir busca (Ctrl+K)"
        aria-haspopup="dialog"
        aria-expanded={false}
        className="focus-ring flex h-11 w-full items-center gap-2 rounded-base border border-line2 bg-bg2 px-3 text-callout text-text2 hover:text-text1"
      >
        <Search size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
        <span className="flex-1 text-left">Buscar…</span>
        <kbd className="rounded-sm border border-line2 px-1 font-mono text-caption text-text2">Ctrl+K</kbd>
      </button>
    );
  }

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ background: "var(--scrim)", paddingTop: "15vh" }}
      className="fixed inset-0 z-50 flex justify-center px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        onClick={(e) => e.stopPropagation()}
        className="h-fit w-full max-w-lg border border-line1 bg-bg2 p-4 shadow-3"
        style={{ borderRadius: 18 }}
      >
        <input
          ref={inputRef}
          placeholder="Buscar clientes, cobranças…"
          aria-label="Buscar"
          className="focus-ring h-11 w-full rounded-base border border-line2 bg-bg1 px-3 text-body text-text1 placeholder:text-text2"
        />
        <p className="m-0 mt-3 text-callout text-text2">
          Busca global fora do escopo da v1 — use a busca da tela de clientes.
        </p>
      </div>
    </div>
  );
}

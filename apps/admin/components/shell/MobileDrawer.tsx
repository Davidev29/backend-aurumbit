"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useSidebarStore } from "@/stores/sidebar-store";
import { EASE_OUT } from "@/lib/motion";
import { NavLinks } from "./Sidebar";

function focusContent(): void {
  requestAnimationFrame(() => {
    const h1 = document.querySelector("main h1") as HTMLElement | null;
    if (h1) {
      if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
      return;
    }
    document.getElementById("conteudo")?.focus({ preventScroll: true });
  });
}

/** Drawer de navegação p/ telas <1024px: 320px/max 85vw, slide-x 240ms, dialog modal com trap de foco. */
export function MobileDrawer() {
  const mobileOpen = useSidebarStore((s) => s.mobileOpen);
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!mobileOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        openerRef.current?.focus?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, setMobileOpen]);

  const closeToOpener = () => {
    setMobileOpen(false);
    // Devolve o foco ao hamburger de forma síncrona (DS §6).
    requestAnimationFrame(() => {
      const opener =
        openerRef.current ??
        (document.querySelector('button[aria-label="Abrir menu"]') as HTMLElement | null);
      opener?.focus?.();
    });
  };

  const closeAndGoContent = () => {
    setMobileOpen(false);
    focusContent();
  };

  // Trap de foco simples dentro do dialog.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {mobileOpen && (
        <>
          <motion.button
            key="scrim"
            type="button"
            aria-label="Fechar menu"
            onClick={closeToOpener}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            style={{ background: "var(--scrim)", zIndex: 45 }}
            className="fixed inset-0 cursor-default border-0 p-0"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            onKeyDown={onPanelKeyDown}
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
            style={{ zIndex: 46 }}
            className="fixed bottom-0 left-0 top-0 flex w-[320px] max-w-[85vw] flex-col border-0 border-r border-line1 bg-bg2 p-3 shadow-3"
          >
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <p className="m-0 flex items-center gap-2 text-headline text-text1">
                <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-base bg-accentsoft">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/logo.png" alt="" aria-hidden="true" className="h-8 w-8 object-contain" />
                </span>
                Aurum Admin
              </p>
              <button
                ref={closeRef}
                type="button"
                aria-label="Fechar menu"
                onClick={closeToOpener}
                className="focus-ring flex h-11 w-11 items-center justify-center rounded-base border border-line2 text-text1"
              >
                <X size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto">
              <NavLinks tall onNavigate={closeAndGoContent} />
            </nav>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

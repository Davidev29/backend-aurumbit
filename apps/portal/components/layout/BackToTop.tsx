"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollToTop } from "@/lib/scroll";

/**
 * Botão flutuante "voltar ao topo".
 *
 * - Aparece suavemente ao rolar **abaixo da 2ª seção** (`#main-content > section`
 *   nº 2 — hoje o Resumo) e some suavemente ao voltar ao início.
 * - Estados controlados por 1 IntersectionObserver na 2ª seção + fallback por
 *   `scrollY` (se a seção não existir). Sem polling, sem throttle manual:
 *   observer + listener passivo com rAF.
 * - `prefers-reduced-motion`: entrada/saída e rolagem instantâneas.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const main = document.querySelector("#main-content");
    const sections = main ? main.querySelectorAll(":scope > section") : null;
    // Hero é <div id="hero">; a 1ª <section> é o Resumo e a 2ª é #produtos.
    // "Abaixo da segunda seção" = passou do Resumo → usa o bottom do Resumo
    // (sections[0]) como gatilho; se a estrutura mudar, cai no fallback scrollY.
    const sentinel = sections && sections.length >= 1 ? sections[0] : null;

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Fallback: ~1.2 viewport ≈ hero + resumo em telas comuns.
        setVisible(window.scrollY > window.innerHeight * 1.1);
      });
    };

    if (!sentinel) {
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("scroll", onScroll);
      };
    }

    // Observer: some quando o Resumo está visível (topo), aparece quando ele
    // sai por cima (usuário desceu além dele).
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Resumo visível → ainda no início: esconde. Mas se o usuário já
          // desceu muito (ex.: reload no meio da página), mantém visível.
          setVisible(window.scrollY > window.innerHeight * 1.1);
        } else {
          setVisible(entry.boundingClientRect.top < 0);
        }
      },
      { threshold: 0, rootMargin: "-8% 0px 0px 0px" }
    );
    observer.observe(sentinel);

    // Sync inicial (reload no meio da página) + fallback scroll.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={scrollToTop}
          aria-label="Voltar ao topo"
          title="Voltar ao topo"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.9 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.9 }}
          transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "btn-primary fixed bottom-24 right-4 z-[29] flex h-12 w-12 items-center justify-center rounded-full shadow-glow-sm",
            "hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-95",
            "md:bottom-8 md:right-8",
            // Acima do StickyCta mobile (bottom-0, altura ~72px + safe-area).
            "mb-[env(safe-area-inset-bottom)] mr-[env(safe-area-inset-right)]"
          )}
        >
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

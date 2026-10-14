"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollToSelector } from "@/lib/scroll";

/**
 * CTA fixo mobile pós-hero — 1 ação ("Ver programas e preços").
 * Aparece após rolar além do hero; some quando `#produtos` está visível.
 * Some também com `prefers-reduced-motion`? Não — é utilidade, não animação;
 * a entrada é instantânea nesse caso.
 */
export function StickyCta() {
  const [pastHero, setPastHero] = useState(false);
  const [onProducts, setOnProducts] = useState(false);

  useEffect(() => {
    const hero = document.querySelector("#hero");
    const products = document.querySelector("#produtos");
    if (!hero || !products) return;

    const heroObserver = new IntersectionObserver(([entry]) => setPastHero(!entry.isIntersecting), {
      threshold: 0,
      rootMargin: "-8% 0px 0px 0px",
    });
    const productsObserver = new IntersectionObserver(([entry]) => setOnProducts(entry.isIntersecting), {
      threshold: 0.08,
    });
    heroObserver.observe(hero);
    productsObserver.observe(products);
    return () => {
      heroObserver.disconnect();
      productsObserver.disconnect();
    };
  }, []);

  const goToProducts = () => scrollToSelector("#produtos");

  const visible = pastHero && !onProducts;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-[29] border-t border-line2 bg-bg1/90 backdrop-blur-md md:hidden",
        "pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
        "transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      )}
    >
      <div className="p-3">
        <button
          type="button"
          onClick={goToProducts}
          tabIndex={visible ? 0 : -1}
          aria-label="Ver programas e preços"
          className="btn-primary inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-base px-4 text-body font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
        >
          Ver programas e preços
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

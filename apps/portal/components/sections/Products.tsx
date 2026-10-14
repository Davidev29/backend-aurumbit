"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Reveal } from "@/components/motion";
import { ProductGrid } from "@/components/products/ProductGrid";
import { ProductSpotlight } from "@/components/products/ProductSpotlight";
import { ProductModal } from "@/components/products/ProductModal";
import { SectionHeading, SectionSkeleton, AuroraWaves } from "@/components/ui";
import { usePortal } from "@/lib/portal-context";
import { listProducts } from "@/lib/api";
import type { ProductView, PlanView } from "@/types";

export function ProductsSection({ products: initialProducts = [] }: { products?: ProductView[] }) {
  const router = useRouter();
  const [products, setProducts] = useState<ProductView[]>(initialProducts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductView | null>(null);
  const { openAuthModal } = usePortal();

  // Tema do fundo aurora (padrão next-themes: SSR = dark, corrige pós-mount).
  // Transparência reduzida = onda a meio brilho.
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [softGlow, setSoftGlow] = useState(false);
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(prefers-reduced-transparency: reduce)");
    setSoftGlow(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSoftGlow(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  const mode = mounted && resolvedTheme === "light" ? "light" : "dark";
  const glow = (mode === "dark" ? 1 : 0.6) * (softGlow ? 0.5 : 1);

  // Revalida vitrine no cliente via BFF (ISR no servidor + refresh aqui).
  // Adiado para idle: o SSR já pinta a vitrine; o refetch não compete
  // com o hero (LCP/INP) no load.
  useEffect(() => {
    let cancelled = false;
    let idleId = 0;
    const run = () => {
      setLoading(true);
      listProducts()
        .then((p) => {
          if (!cancelled && p.data.length > 0) setProducts(p.data);
        })
        .catch((e: Error) => {
          if (!cancelled && initialProducts.length === 0) {
            console.error("[ProductsSection] falha ao revalidar vitrine:", e);
            setError("Não foi possível carregar os planos. Verifique sua conexão e tente de novo.");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => {
        if (!cancelled) run();
      }, { timeout: 2500 });
    } else {
      run();
    }
    return () => {
      cancelled = true;
      if (idleId && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProductClick = (product: ProductView) => {
    setSelectedProduct(product);
  };

  const handlePurchase = (plan: PlanView) => {
    // Leva ao checkout com produto + plano — nada se perde no caminho.
    const product = selectedProduct;
    setSelectedProduct(null);
    if (product) {
      router.push(`/checkout?code=${encodeURIComponent(product.code)}&plan=${encodeURIComponent(plan.id)}`);
    } else {
      openAuthModal("register");
    }
  };

  const retry = () => {
    setError(null);
    setLoading(true);
    listProducts()
      .then((p) => setProducts(p.data))
      .catch(() => setError("Não foi possível carregar os planos. Verifique sua conexão e tente de novo."))
      .finally(() => setLoading(false));
  };

  return (
    <section
      id="produtos"
      className="section-py relative isolate overflow-hidden bg-bg0"
      aria-labelledby="products-title"
      aria-busy={loading}
    >
      {/* Fundo aurora + vidro idêntico ao do banner; conteúdo em z-[2]. */}
      <div className="prod-aurora" aria-hidden="true">
        <div className="prod-aurora-static" />
        <AuroraWaves theme={mode} glow={glow} />
        <div className="prod-aurora-veil" />
        <div className="prod-aurora-glass" />
      </div>
      <div className="container-portal relative z-[2]">
        <SectionHeading
          id="products-title"
          eyebrow="Programas prontos"
          title={<>Programas para <span className="text-accent">cada tamanho de empresa</span></>}
          subtitle="Sistemas prontos para cada tamanho de empresa — e sob medida com agentes IA quando a operação pede mais."
        />

        <Reveal variant="slide-up" delay={0}>
          <Suspense fallback={<SectionSkeleton count={6} />}>
            <ProductGrid
              products={products}
              onProductClick={handleProductClick}
              loading={loading && products.length === 0}
              error={error ?? undefined}
              onRetry={retry}
            />
          </Suspense>
        </Reveal>

        <ProductSpotlight products={products} onSelect={handleProductClick} />
      </div>

      {/* Product Detail Modal */}
      <ProductModal
        product={selectedProduct}
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        onPurchase={handlePurchase}
      />
    </section>
  );
}

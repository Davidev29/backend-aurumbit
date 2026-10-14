"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Package } from "lucide-react";
import { ProductCard } from "./ProductCard";
import { Button, ProductCardSkeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ProductView } from "@/types";

interface ProductGridProps {
  products: ProductView[];
  initialCategory?: string;
  onProductClick?: (product: ProductView) => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

const GRID_CLASSES = "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 md:gap-6 lg:grid-cols-3";

function FilterChip({
  label,
  count,
  active,
  onSelect,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2 text-caption font-semibold transition-[background-color,border-color,color] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active
          ? "border-transparent bg-gradient-gold text-on-gold shadow-glow-sm"
          : "border-line2 bg-transparent text-text2 hover:border-accent/60 hover:text-accent"
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 font-mono text-micro",
          active ? "bg-[#1A140B]/15 text-on-gold" : "bg-bg2 text-text3"
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function ProductGrid({
  products,
  initialCategory = "all",
  onProductClick,
  loading = false,
  error,
  onRetry,
}: ProductGridProps) {
  const [activeCategory, setActiveCategory] = useState(initialCategory);

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [products]);

  const countFor = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach((p) => {
      if (p.category) map.set(p.category, (map.get(p.category) ?? 0) + 1);
    });
    return map;
  }, [products]);

  // Filter products
  const filteredProducts = useMemo(() => {
    if (activeCategory === "all") return products;
    return products.filter((p) => p.category === activeCategory);
  }, [products, activeCategory]);

  if (loading) {
    return (
      <div className={GRID_CLASSES} role="status" aria-label="Carregando produtos">
        {Array.from({ length: 6 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-8 text-center" role="alert">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft">
          <AlertTriangle className="h-7 w-7 text-danger" aria-hidden="true" />
        </div>
        <h3 className="mb-2 font-display font-semibold text-text1">Erro ao carregar produtos</h3>
        <p className="mb-6 text-text2">{error}</p>
        <Button variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Category Filter — gold pills with active glow */}
      <div className="mb-6 flex flex-wrap gap-2 sm:mb-8" role="group" aria-label="Filtrar por categoria">
        <FilterChip
          label="Todos"
          count={products.length}
          active={activeCategory === "all"}
          onSelect={() => setActiveCategory("all")}
        />
        {categories.map((category) => (
          <FilterChip
            key={category}
            label={category}
            count={countFor.get(category) ?? 0}
            active={activeCategory === category}
            onSelect={() => setActiveCategory(category)}
          />
        ))}
      </div>

      {filteredProducts.length === 0 ? (
        <div className="glass-card col-span-full p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
            <Package className="h-7 w-7 text-accent" aria-hidden="true" />
          </div>
          <h3 className="mb-2 font-display font-semibold text-text1">Nenhum produto encontrado</h3>
          <p className="mb-6 text-text2">Tente alterar o filtro ou volte mais tarde.</p>
          {activeCategory !== "all" && (
            <Button variant="outline" onClick={() => setActiveCategory("all")}>
              Limpar filtro
            </Button>
          )}
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          <motion.div
            key={activeCategory}
            className={GRID_CLASSES}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            role="list"
            aria-label={`Produtos${activeCategory !== "all" ? ` - ${activeCategory}` : ""}`}
          >
            {filteredProducts.map((product, index) => (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3, delay: 0, ease: [0.16, 1, 0.3, 1] }}
                role="listitem"
              >
                <ProductCard
                  product={product}
                  onClick={() => onProductClick?.(product)}
                />
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Results count */}
      <p className="mt-6 text-center text-caption text-text3" aria-live="polite">
        Exibindo <span className="font-semibold text-text1">{filteredProducts.length}</span> de {products.length} produto{products.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

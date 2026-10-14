"use client";

import { Check, LifeBuoy, Monitor, WifiOff } from "lucide-react";
import { Reveal } from "@/components/motion";
import { Button } from "@/components/ui";
import { cn, formatCurrency } from "@/lib/utils";
import type { ProductView } from "@/types";

interface ProductSpotlightProps {
  products: ProductView[];
  onSelect: (product: ProductView) => void;
}

const ORDER = ["aurum-base", "aurum-pro", "aurum-enterprise"] as const;

const SUPPORT: Record<string, string> = {
  "aurum-base": "Ajuda em português",
  "aurum-pro": "Suporte prioritário",
  "aurum-enterprise": "Gerente dedicado",
};

/**
 * Vitrine editorial por produto — detalhe e argumento de venda por programa,
 * em fileiras alternadas (nunca grade idêntica). Dados 100% do catálogo SSR.
 */
export function ProductSpotlight({ products, onSelect }: ProductSpotlightProps) {
  const ordered = ORDER.map((code) => products.find((p) => p.code === code)).filter(
    (p): p is ProductView => !!p
  );
  if (ordered.length === 0) return null;

  return (
    <div className="mx-auto mt-12 max-w-5xl space-y-4 sm:space-y-6 md:mt-16">
      {ordered.map((product, index) => {
        const isEnterprise = product.code === "aurum-enterprise";
        const activePlans = product.plans.filter((p) => p.status === "ATIVO");
        const monthly = activePlans.find((p) => p.billingInterval === "MONTH");
        const annual = activePlans.find((p) => p.billingInterval === "YEAR");
        const anchor = monthly || annual || activePlans[0];
        const features = activePlans
          .flatMap((p) => p.features || [])
          .filter((f, i, arr) => arr.findIndex((x) => x.featureCode === f.featureCode) === i)
          .slice(0, 4);
        const flipped = index % 2 === 1;

        return (
          <Reveal key={product.code} variant="slide-up" delay={0}>
            <article
              aria-labelledby={`spotlight-${product.code}`}
              className="glass-card grid min-w-0 gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_1.2fr] lg:gap-10 lg:p-8"
            >
              {/* Identidade + argumento */}
              <div className={cn("min-w-0", flipped && "lg:order-2")}>
                <p className="text-micro font-semibold uppercase tracking-wider text-accent">
                  {product.category ?? "Programa"}
                </p>
                <h3
                  id={`spotlight-${product.code}`}
                  className="mt-1 font-display text-section font-extrabold text-text1"
                >
                  {product.name}
                </h3>
                <p className="mt-2 max-w-md text-body leading-relaxed text-text2">
                  {product.shortDescription || product.description?.split("\n")[0]}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-caption text-text2">
                  <span className="inline-flex items-center gap-1.5">
                    <Monitor className="h-4 w-4 text-accent" aria-hidden="true" />
                    <span className="tabular-nums">
                      {product.machinesAllowed}{isEnterprise ? "+" : ""}{" "}
                      {product.machinesAllowed === 1 ? "computador" : "computadores"}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <WifiOff className="h-4 w-4 text-accent" aria-hidden="true" />
                    100% offline
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <LifeBuoy className="h-4 w-4 text-accent" aria-hidden="true" />
                    {SUPPORT[product.code] ?? "Em português"}
                  </span>
                </div>
              </div>

              {/* Detalhes + preço + ação */}
              <div className={cn("flex min-w-0 flex-col", flipped && "lg:order-1")}>
                <ul className="space-y-2.5" role="list">
                  {features.map((f) => (
                    <li key={f.featureCode} className="flex items-start gap-2.5 text-body text-text2">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-ok" aria-hidden="true" />
                      {f.featureCode}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 border-t border-line2 pt-4">
                  {isEnterprise || !anchor ? (
                    <p className="font-display text-headline font-bold text-text1">
                      Proposta sob medida
                    </p>
                  ) : (
                    <p className="text-body text-text2">
                      A partir de{" "}
                      <span className="font-display text-headline font-extrabold tabular-nums text-accent">
                        {formatCurrency(anchor.priceCents / 100)}
                      </span>{" "}
                      {anchor.billingInterval === "MONTH" ? "por mês" : anchor.billingInterval === "YEAR" ? "por ano" : ""}
                      <span className="text-caption"> · licença individual</span>
                    </p>
                  )}
                  <div className="mt-4">
                    {isEnterprise ? (
                      <a
                        href="mailto:contato@aurumbit.com?subject=Quero%20conhecer%20o%20Aurum%20Enterprise"
                        className="btn-ghost inline-flex min-h-[48px] items-center justify-center gap-2 rounded-base border border-line2 px-6 text-body font-semibold text-text1 transition-[background-color,border-color,color] duration-150 hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        Falar com a AurumBit
                      </a>
                    ) : (
                      <Button variant="primary" size="lg" onClick={() => onSelect(product)}>
                        Ver detalhes do {product.name.replace("Aurum ", "")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          </Reveal>
        );
      })}
      <p className="text-center text-caption text-text2">
        Total e condições sempre escritos antes de confirmar. Chave liberada após a confirmação do pagamento.
      </p>
    </div>
  );
}

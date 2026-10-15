"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Check, Monitor, Smartphone, Globe, Cpu, Shield, Database, Zap, WifiOff } from "lucide-react";
import { Modal, Badge, Button } from "@/components/ui";
import { GoldIcon } from "@/components/ui/GoldIcon";
import { cn, formatCurrency } from "@/lib/utils";
import type { ProductView, PlanView } from "@/types";

interface ProductModalProps {
  product: ProductView | null;
  isOpen: boolean;
  onClose: () => void;
  onPurchase?: (plan: PlanView) => void;
}

const platformIcons = {
  windows: Monitor,
  macos: Cpu,
  linux: Cpu,
  web: Globe,
  mobile: Smartphone,
};

const platformLabels: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  web: "Web",
  mobile: "Mobile",
};

export function ProductModal({ product, onClose, isOpen, onPurchase }: ProductModalProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  // Default elegível: anual → mensal → vitalício. Seleção NÃO dispara compra.
  useEffect(() => {
    if (!product) {
      setSelectedPlanId(null);
      return;
    }
    const active = product.plans.filter((p) => p.status === "ATIVO");
    setSelectedPlanId(
      active.find((p) => p.billingInterval === "YEAR")?.id ??
        active.find((p) => p.billingInterval === "MONTH")?.id ??
        active.find((p) => p.billingInterval === "ONE_TIME")?.id ??
        active[0]?.id ??
        null
    );
  }, [product]);

  if (!product) return null;

  const activePlans = product.plans.filter((p) => p.status === "ATIVO");
  const selectedPlan = activePlans.find((p) => p.id === selectedPlanId) ?? null;
  const monthlyPlan = activePlans.find((p) => p.billingInterval === "MONTH");
  const annualPlan = activePlans.find((p) => p.billingInterval === "YEAR");

  const isEnterprise = product.code === "aurum-enterprise";

  const discount =
    monthlyPlan && annualPlan && monthlyPlan.priceCents > 0
      ? Math.max(0, Math.round((1 - annualPlan.priceCents / (monthlyPlan.priceCents * 12)) * 100))
      : 0;

  const features = activePlans.flatMap((p) => p.features || []);
  const uniqueFeatures = features.filter(
    (f, i, arr) => arr.findIndex((x) => x.featureCode === f.featureCode) === i
  );

  const short =
    product.shortDescription ??
    (product.description ? product.description.slice(0, 110).trim() + "…" : undefined);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product.name}
      description={short}
      size="xl"
    >
      <div className="flex max-h-[80dvh] flex-col md:max-h-[70dvh]">
        <div className="grid flex-1 min-h-0 flex-shrink gap-5 overflow-y-auto pr-1 md:grid-cols-[300px_minmax(0,1fr)] md:overflow-hidden md:pr-0">
          {/* Coluna esquerda: visual + specs compactos (fixa no desktop) */}
          <aside className="min-w-0 space-y-3 md:overflow-hidden md:pr-1">
            <ProductVisual product={product} />

            {/* Specs em tiles compactos */}
            <section aria-label="Especificações" className="grid grid-cols-3 gap-1.5">
              <div className="rounded-base border border-line2 px-2 py-2 text-center">
                <Monitor className="mx-auto mb-1 h-4 w-4 text-accent" aria-hidden="true" />
                <p className="font-display text-body font-bold leading-none text-text1">
                  {product.machinesAllowed}
                </p>
                <p className="mt-0.5 text-caption text-text3">computadores</p>
              </div>
              <div className="rounded-base border border-line2 px-2 py-2 text-center">
                <WifiOff className="mx-auto mb-1 h-4 w-4 text-ok" aria-hidden="true" />
                <p className="font-display text-body font-bold leading-none text-text1">100%</p>
                <p className="mt-0.5 text-caption text-text3">offline</p>
              </div>
              <div className="rounded-base border border-line2 px-2 py-2 text-center">
                <Database className="mx-auto mb-1 h-4 w-4 text-info" aria-hidden="true" />
                <p className="truncate font-display text-body font-bold leading-none text-text1">
                  {product.category ?? "Geral"}
                </p>
                <p className="mt-0.5 text-caption text-text3">categoria</p>
              </div>
            </section>

            {/* Plataformas + confiança */}
            <div className="flex flex-wrap items-center gap-1.5">
              {["windows", "macos", "linux", "web"].map((platform) => {
                const PlatformIcon = platformIcons[platform as keyof typeof platformIcons];
                return (
                  <Badge key={platform} variant="neutral" size="sm">
                    <PlatformIcon className="h-3 w-3" aria-hidden="true" />
                    {platformLabels[platform]}
                  </Badge>
                );
              })}
            </div>
            <p className="inline-flex items-start gap-1 text-caption leading-snug text-text3">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
              Chave liberada após a confirmação do pagamento · funciona offline por natureza
            </p>
          </aside>

          {/* Coluna direita: cobrança + recursos (rola sozinha no desktop) */}
          <div className="min-w-0 space-y-4 md:min-h-0 md:overflow-y-auto md:pr-1 md:pb-1">

          {/* Cobrança */}
          <section aria-label="Escolha como pagar">
            <h4 className="mb-2 font-display text-body font-semibold text-text1">
              Escolha como pagar
            </h4>
            {activePlans.length === 0 ? (
              <div className="py-6 text-center text-text2">
                <Shield className="mx-auto mb-2 h-10 w-10 text-text3" aria-hidden="true" />
                <p className="text-body">Sem planos ativos no momento.</p>
              </div>
            ) : (
              <div role="radiogroup" aria-label="Cobrança mensal ou anual" className="space-y-1.5">
                {activePlans.map((plan) => {
                  const isAnnual = plan.billingInterval === "YEAR";
                  const label =
                    plan.billingInterval === "MONTH"
                      ? "Mensal"
                      : plan.billingInterval === "YEAR"
                        ? "Anual"
                        : "Vitalício";
                  const badge =
                    plan.billingInterval === "MONTH"
                      ? "Pagamento por mês"
                      : plan.billingInterval === "YEAR"
                        ? discount > 0
                          ? `Preço menor: economize ${discount}% no ano`
                          : "Preço menor no ano"
                        : "Pagamento único";
                  const selected = plan.id === selectedPlanId;
                  return (
                    <div
                      key={plan.id}
                      role="radio"
                      aria-checked={selected}
                      aria-label={`${plan.name} — ${formatCurrency(plan.priceCents / 100)}`}
                      tabIndex={0}
                      onClick={() => setSelectedPlanId(plan.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedPlanId(plan.id);
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 rounded-base border-2 px-2.5 py-2 transition-[border-color,background-color] duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        selected || (isAnnual && !selectedPlan)
                          ? "border-accent bg-accent-soft"
                          : "border-line2 hover:border-accent"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                            selected ? "border-accent" : "border-line2"
                          )}
                        >
                          {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-body leading-tight text-text1">
                            {label}
                          </span>
                          <span className="block truncate text-caption text-text3">{badge}</span>
                        </span>
                        {isAnnual && (
                          <Badge variant="gold" size="sm" className="ml-1 shrink-0">
                            Popular
                          </Badge>
                        )}
                      </span>
                      <span className="shrink-0 text-right font-display text-body font-bold text-text1">
                        {formatCurrency(plan.priceCents / 100)}
                        {plan.billingInterval !== "ONE_TIME" && (
                          <span className="block text-caption font-normal leading-none text-text3">
                            /{plan.billingInterval === "MONTH" ? "mês" : "ano"}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recursos */}
          {uniqueFeatures.length > 0 && (
            <section aria-label="Recursos incluídos">
              <h4 className="mb-2 font-display text-body font-semibold text-text1">
                Recursos incluídos
              </h4>
              <ul className="grid gap-1.5 sm:grid-cols-2" role="list">
                {uniqueFeatures.slice(0, 4).map((feature) => (
                  <li
                    key={feature.featureCode}
                    className="flex items-center gap-1.5 rounded-base border border-line2 bg-bg2/50 px-2.5 py-1.5"
                  >
                    <Check className="h-3.5 w-3.5 flex-shrink-0 text-ok" aria-hidden="true" />
                    <span className="truncate text-caption font-medium text-text1">
                      {feature.featureCode}
                    </span>
                    {feature.value && (
                      <span className="ml-auto shrink-0 font-mono text-caption text-text3">
                        {feature.value}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {uniqueFeatures.length > 4 && (
                <p className="mt-1.5 text-caption text-text3">
                  +{uniqueFeatures.length - 4} recursos no plano selecionado
                </p>
              )}
            </section>
          )}
        </div>
        </div>

        {/* Rodapé fixo: total + CTA (compra só aqui, nunca na seleção) */}
        <div className="mt-3 flex items-center gap-2 border-t border-line2 pt-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-caption leading-none text-text3">
              {selectedPlan?.name ?? "Selecione um plano"}
            </p>
            <p className="mt-1 font-display text-title-page font-extrabold leading-none text-accent">
              {selectedPlan ? formatCurrency(selectedPlan.priceCents / 100) : "—"}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          {isEnterprise ? (
            <a
              href="mailto:contato@aurumbit.com?subject=Quero%20conhecer%20o%20Aurum%20Enterprise"
              className="btn-primary inline-flex min-h-[44px] items-center justify-center gap-2 rounded-base px-4 py-2 text-body font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
            >
              Falar com a AurumBit
            </a>
          ) : (
            <Button
              variant="primary"
              disabled={!selectedPlan}
              onClick={() => selectedPlan && onPurchase?.(selectedPlan)}
            >
              Continuar
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Card visual vertical para a coluna esquerda — compacto, sem esticar o modal. */
function ProductVisual({ product }: { product: ProductView }) {
  const [failed, setFailed] = useState(false);
  const img = product.gallery[0];

  useEffect(() => {
    setFailed(false);
  }, [product.id]);

  return (
    <div className="relative h-36 overflow-hidden rounded-card border border-line2 bg-gradient-to-br from-accent/25 via-bg2 to-bg2 md:h-[190px]">
      <div className="bg-grid-gold absolute inset-0 opacity-70" aria-hidden="true" />
      {!failed && img?.url ? (
        <>
          <Image
            src={img.url}
            alt={img.alt || product.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 512px"
            onError={() => setFailed(true)}
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-bg0/85 via-bg0/20 to-transparent"
            aria-hidden="true"
          />
        </>
      ) : null}
      <div className="absolute inset-0 flex items-center gap-3 p-4">
        <GoldIcon icon={Cpu} size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            {product.category && (
              <Badge variant="gold" size="sm">
                {product.category}
              </Badge>
            )}
            <Badge variant="neutral" size="sm">
              {product.machinesAllowed} computador{product.machinesAllowed > 1 ? "es" : ""}
            </Badge>
            {product.gallery.length > 1 && (
              <Badge variant="neutral" size="sm">
                +{product.gallery.length - 1} fotos
              </Badge>
            )}
          </div>
          {product.tags && product.tags.length > 0 && (
            <p className="mt-1.5 truncate text-caption text-text2">{product.tags.join(" · ")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

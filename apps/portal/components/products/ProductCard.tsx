"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { ChevronRight, Cpu, Check } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui";
import type { ProductView } from "@/types";

interface ProductCardProps {
  product: ProductView;
  onClick?: () => void;
  variant?: "default" | "compact";
}

export function ProductCard({ product, onClick, variant = "default" }: ProductCardProps) {
  const isEnterprise = product.code === "aurum-enterprise";
  const cardCta =
    product.code === "aurum-base"
      ? "Ver planos do Base"
      : product.code === "aurum-pro"
        ? "Ver planos do Pro"
        : isEnterprise
          ? "Falar com a AurumBit"
          : "Ver detalhes";
  const activePlans = product.plans.filter((p) => p.status === "ATIVO");
  const primaryPlan = activePlans[0] || product.plans[0];
  const monthlyPlan = activePlans.find((p) => p.billingInterval === "MONTH");
  const annualPlan = activePlans.find((p) => p.billingInterval === "YEAR");
  const anchorPlan = monthlyPlan || annualPlan || primaryPlan;
  const anchorSuffix =
    anchorPlan?.billingInterval === "MONTH"
      ? "/mês"
      : anchorPlan?.billingInterval === "YEAR"
        ? "/ano"
        : "";
  const discount =
    monthlyPlan && annualPlan && monthlyPlan.priceCents > 0
      ? Math.max(0, Math.round((1 - annualPlan.priceCents / (monthlyPlan.priceCents * 12)) * 100))
      : 0;

  const uniqueFeatures = activePlans
    .flatMap((p) => p.features || [])
    .filter((f, i, arr) => arr.findIndex((x) => x.featureCode === f.featureCode) === i)
    .slice(0, 3);

  const handleCta = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEnterprise) {
      window.location.href =
        "mailto:contato@aurumbit.com?subject=Quero%20conhecer%20o%20Aurum%20Enterprise";
      return;
    }
    onClick?.();
  };
  if (variant === "compact") {
    return (
      <motion.div
        className="glass-card flex cursor-pointer items-center gap-4 p-4 transition-[transform,border-color,box-shadow] duration-150"
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); }}}
      >
        <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-base bg-gradient-gold/20">
          {product.gallery[0] && product.gallery[0].kind !== "video" ? (
            <Image
              src={product.gallery[0].url}
              alt={product.name}
              fill
              className="object-cover"
              sizes="64px"
            />
          ) : (
            <Cpu className="h-8 w-8 text-accent" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display font-semibold text-text1">{product.name}</h3>
          <p className="mt-0.5 truncate text-caption text-text2">{product.shortDescription || product.description?.slice(0, 80)}</p>
          <div className="mt-2 flex items-center gap-2">
            {primaryPlan && (
              <span className="font-mono font-semibold text-accent">
                {formatCurrency(primaryPlan.priceCents / 100)}{primaryPlan.billingInterval === "MONTH" ? "/mês" : primaryPlan.billingInterval === "YEAR" ? "/ano" : " · único"}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 flex-shrink-0 text-text3" />
      </motion.div>
    );
  }

  return (
    <motion.article
      className="glass-card group flex h-full cursor-pointer flex-col overflow-hidden p-5 transition-colors duration-150 hover:border-line3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); }}}
      aria-label={`${product.name} — ver planos`}
    >
      {/* Linha de contexto: categoria + máquinas + offline */}
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text2">
        {product.category && (
          <span className="font-semibold text-accent">{product.category}</span>
        )}
        <span aria-hidden="true" className="text-text3">·</span>
        <span className="tabular-nums">
          {product.machinesAllowed}{product.code === "aurum-enterprise" ? "+" : ""} {product.machinesAllowed === 1 ? "computador" : "computadores"}
        </span>
        <span aria-hidden="true" className="text-text3">·</span>
        <span>100% offline</span>
      </div>

      {/* Título + descrição em 1 linha */}
      <h3 className="font-display text-headline font-bold text-text1">
        {product.name}
      </h3>
      <p className="mb-4 mt-1 line-clamp-1 flex-none text-body text-text2">
        {product.shortDescription || product.description?.split("\n")[0] || "Descrição não disponível"}
      </p>

      {/* Preço-âncora */}
      {anchorPlan && (
        <div className="mb-4">
          <p className="text-caption text-text2">
            A partir de
          </p>
          <p className="font-display text-kpi font-extrabold text-accent">
            {formatCurrency(anchorPlan.priceCents / 100)}
            <span className="font-sans text-body font-normal text-text2">{anchorSuffix}</span>
          </p>
          {discount > 0 && annualPlan && (
            <p className="mt-0.5 text-caption tabular-nums text-text2">
              ou {formatCurrency(annualPlan.priceCents / 100)}/ano — economize {discount}%
            </p>
          )}
        </div>
      )}

      {/* Diferenciais (máx. 3) */}
      {uniqueFeatures.length > 0 && (
        <ul className="mb-5 space-y-2" role="list">
          {uniqueFeatures.map((f) => (
            <li key={f.featureCode} className="flex items-start gap-2 text-body text-text2">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-ok" aria-hidden="true" />
              <span className="line-clamp-1">{f.featureCode}</span>
            </li>
          ))}
        </ul>
      )}

      {/* CTA */}
      <div className="mt-auto pt-1">
        <Button
          variant={isEnterprise ? "ghost" : "primary"}
          fullWidth
          rightIcon={<ChevronRight className="h-4 w-4" />}
          onClick={handleCta}
        >
          {cardCta}
        </Button>
      </div>
    </motion.article>
  );
}

export function ProductCardSkeletonCompact() {
  return (
    <div className={cn("glass-card flex items-center gap-4 p-4")} role="status" aria-label="Carregando produto">
      <div className="skeleton h-16 w-16 flex-shrink-0 rounded-base" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton h-5 w-2/3 rounded-base" />
        <div className="skeleton h-4 w-full rounded-base" />
        <div className="skeleton h-4 w-1/3 rounded-base" />
      </div>
    </div>
  );
}

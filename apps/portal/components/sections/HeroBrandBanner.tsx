"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { AurumCssLogo } from "@/components/ui/AurumCssLogo";
import { scrollToSelector } from "@/lib/scroll";

/**
 * Banner principal da landpage — a logomarca AurumBit desenhada em CSS como
 * peça central animada (`AurumCssLogo`), no lugar do motor WebGL de
 * partículas (`HeroLiquidBanner`, mantido no repo como alternativa).
 *
 * Camadas (fundo → frente): foto `/fundo-banner.jpg` → véu do tema →
 * vidro glasmorphism → logo CSS + copy + CTAs. Mesma copy/âncoras do banner
 * anterior; H1 único da página preservado para SEO.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

function Rise({
  children,
  delay,
  className,
}: {
  children: React.ReactNode;
  delay: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0.2 : 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function HeroBrandBanner() {
  const go = (selector: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToSelector(selector);
  };

  return (
    <section className="hero-brand" aria-label="Apresentação AurumBit">
      <div className="hero-brand-photo" aria-hidden="true">
        <img src="/fundo-banner.jpg" alt="" width={720} height={404} draggable={false} />
      </div>
      <div className="hero-brand-veil" aria-hidden="true" />
      <div className="hero-brand-glass" aria-hidden="true" />

      <div className="hero-brand-inner container-portal">
        <Rise delay={0}>
          <p className="hero-brand-eyebrow">Software sob medida + IA aplicada ao seu negócio</p>
        </Rise>

        <Rise delay={0.08}>
          <AurumCssLogo />
        </Rise>

        <Rise delay={0.18}>
          <h1 className="hero-brand-h1">
            Sistemas que colocam
            <br />
            sua empresa <span className="text-accent">no padrão.</span>
          </h1>
        </Rise>

        <Rise delay={0.28}>
          <p className="hero-brand-body">
            Desenvolvemos sistemas, painéis, integrações e automações com a tecnologia certa
            para cada caso — e treinamos agentes de IA especialistas no seu setor, conectados
            direto à base da sua empresa.
          </p>
        </Rise>

        <Rise delay={0.38}>
          <div className="hero-brand-ctas">
            <a
              className="btn-primary inline-flex min-h-[48px] items-center gap-2 rounded-base px-6 text-body font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
              href="#produtos"
              onClick={go("#produtos")}
            >
              Ver sistemas e serviços
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </a>
            <a
              className="inline-flex min-h-[48px] items-center gap-2 rounded-base border border-line2 px-6 text-body font-medium text-text1 transition-[background-color,border-color,color] duration-150 hover:bg-bg2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              href="#ia-especialistas"
              onClick={go("#ia-especialistas")}
            >
              Criar meu agente IA
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </a>
          </div>
        </Rise>
      </div>
    </section>
  );
}

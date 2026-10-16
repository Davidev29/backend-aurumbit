"use client";

import {
  AppWindow,
  PlugZap,
  LayoutDashboard,
  Bot,
  BadgeCheck,
  WifiOff,
  LifeBuoy,
  Database,
  BarChart3,
  Workflow,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface TrustBarItem {
  icon: LucideIcon;
  label: string;
}

interface TrustBarProps {
  items?: TrustBarItem[];
}

/** Faixa de confiança: o que realmente entregamos, em texto direto. */
const DEFAULT_ITEMS: TrustBarItem[] = [
  { icon: AppWindow, label: "Sistemas sob medida" },
  { icon: PlugZap, label: "Integrações e automações" },
  { icon: LayoutDashboard, label: "Painéis e relatórios" },
  { icon: Bot, label: "Agentes IA na sua base" },
  { icon: BadgeCheck, label: "Preço fechado antes de começar" },
  { icon: WifiOff, label: "Funciona sem internet" },
  { icon: BarChart3, label: "Relatórios em tempo real" },
  { icon: Workflow, label: "Fluxos automáticos" },
  { icon: Database, label: "Dados da sua operação" },
  { icon: ShieldCheck, label: "Controle de acesso" },
  { icon: Sparkles, label: "IA no seu vocabulário" },
  { icon: LifeBuoy, label: "Suporte prioritário" },
];

/** Quantas vezes cada metade repete a lista — garante largura > 200% do viewport. */
const REPEAT_PER_HALF = 3;

function MarqueeHalf({ items, hidden }: { items: TrustBarItem[]; hidden?: boolean }) {
  const loop = Array.from({ length: REPEAT_PER_HALF }, () => items).flat();
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden ? "true" : undefined}>
      {loop.map(({ icon: Icon, label }, i) => (
        <span key={`${label}-${i}`}
          className="mx-7 flex items-center gap-2.5 whitespace-nowrap"
        >
          <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" strokeWidth={1.75} />
          <span className="text-caption font-medium text-text2">{label}</span>
          <span
            className="ml-7 inline-block h-1.5 w-1.5 shrink-0 rotate-45 bg-accent/40"
            aria-hidden="true"
          />
        </span>
      ))}
    </div>
  );
}

/**
 * Faixa de confiança no rodapé do hero.
 * Marquee infinito real: 2 metades idênticas (cada uma com 3x a lista),
 * animação de -50% em loop linear — nunca há fim nem salto.
 * Pausa no hover/focus, respeita prefers-reduced-motion e forced-colors.
 */
export function TrustBar({ items = DEFAULT_ITEMS }: TrustBarProps) {
  return (
    <div className="relative border-t border-line2 bg-bg1/60 backdrop-blur-md">
      <style>{`
        @keyframes hero-marquee {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-50%, 0, 0); }
        }
        .hero-marquee-viewport {
          mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
          -webkit-mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
        }
        .hero-marquee-track {
          animation: hero-marquee 60s linear infinite;
          will-change: transform;
          backface-visibility: hidden;
        }
        .hero-marquee:hover .hero-marquee-track,
        .hero-marquee:focus-within .hero-marquee-track,
        .hero-marquee:active .hero-marquee-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-marquee-track { animation: none !important; }
        }
        @media (forced-colors: active) {
          .hero-marquee-viewport { mask-image: none; -webkit-mask-image: none; }
        }
      `}</style>
      <div className="container-portal px-4 pb-1 pt-5 text-center">
        <p className="text-micro font-semibold uppercase tracking-wider text-accent">
          Sistemas modernos para operação real
        </p>
        <p className="mt-1 text-caption text-text2">
          Do sistema ao agente IA — preço fechado antes de começar, sem taxa escondida.
        </p>
      </div>
      <div className="hero-marquee relative overflow-hidden py-3.5">
        <div
          className="hero-marquee-viewport overflow-hidden"
        >
          <div className="hero-marquee-track flex w-max">
            <MarqueeHalf items={items} />
            <MarqueeHalf items={items} hidden />
          </div>
        </div>
      </div>
    </div>
  );
}

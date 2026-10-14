"use client";

import { AppWindow, PlugZap, LayoutDashboard, Bot } from "lucide-react";
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
];

function MarqueeCopy({ items, hidden }: { items: TrustBarItem[]; hidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden ? "true" : undefined}>
      {items.map(({ icon: Icon, label }) => (
        <span key={label} className="mx-6 flex items-center gap-2.5 whitespace-nowrap">
          <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="text-caption font-medium text-text2">{label}</span>
          <span className="ml-6 h-1 w-1 shrink-0 rounded-full bg-accent/50" aria-hidden="true" />
        </span>
      ))}
    </div>
  );
}

/**
 * Faixa de confiança no rodapé do hero.
 * Serviços em marquee CSS — pausa no hover,
 * respeita prefers-reduced-motion.
 */
export function TrustBar({ items = DEFAULT_ITEMS }: TrustBarProps) {
  return (
    <div className="relative border-t border-line2 bg-bg1/60 backdrop-blur-md">
      <style>{`
        @keyframes hero-marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-marquee-track { animation: none !important; }
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
      <div className="relative overflow-hidden py-3">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-bg0 to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-bg0 to-transparent"
          aria-hidden="true"
        />
        <div
          className="hero-marquee-track flex w-max hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] active:[animation-play-state:paused] motion-reduce:animate-none"
          style={{ animation: "hero-marquee 30s linear infinite" }}
        >
          <MarqueeCopy items={items} />
          <MarqueeCopy items={items} hidden />
        </div>
      </div>
    </div>
  );
}

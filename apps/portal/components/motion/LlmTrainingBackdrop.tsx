"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Palavras da operação do cliente que sobem como tokens em treino. */
const TOKENS = [
  "pedido",
  "cliente",
  "prazo",
  "estoque",
  "venda",
  "agenda",
  "entrega",
  "equipe",
  "conta",
  "meta",
  "contrato",
  "suporte",
];

/** Colunas de tokens — posição/ritmo determinísticos (SSR-estável). */
const TOKEN_COLS = TOKENS.map((word, i) => ({
  word,
  left: (i * 37.3 + 6) % 100,
  duration: 12 + ((i * 7) % 8),
  delay: -((i * 2.9) % 16),
  size: i % 3 === 0 ? "text-micro" : "text-caption",
}));

/** Grade de embeddings — onda diagonal via delay inline. */
const EMB_COLS = 22;
const EMB_ROWS = 8;

/** Nós das camadas (atenção): 3 colunas × 5 nós, em viewBox 1000×600. */
const LAYERS = [150, 500, 850];
const NODES = LAYERS.flatMap((cx, li) =>
  [110, 205, 300, 395, 490].map((cy, ni) => ({ cx, cy, key: `${li}-${ni}` }))
);

/** Arcos de atenção entre camadas consecutivas. */
const ARCS = [
  "M150 205 C 280 205, 370 110, 500 110",
  "M150 300 C 280 300, 370 300, 500 300",
  "M150 395 C 280 395, 370 490, 500 490",
  "M500 110 C 630 110, 720 205, 850 205",
  "M500 300 C 630 300, 720 300, 850 300",
  "M500 490 C 630 490, 720 395, 850 395",
];

/**
 * Fundo de "treino de LLM": grade de embeddings em onda + camadas de
 * atenção com fluxo + curva de aprendizado + tokens da operação subindo.
 * Fica POR BAIXO da placa de vidro (`hero-glass`) e do conteúdo.
 * Decorativo (`aria-hidden`), só transform/opacity/dashoffset,
 * estático sob `prefers-reduced-motion` ou antes do mount.
 */
export function LlmTrainingBackdrop({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const still = !mounted || reduced;

  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      {/* lavagem dourada de fundo */}
      <div className="absolute inset-0 [background:radial-gradient(ellipse_60%_45%_at_50%_30%,rgba(192,160,96,0.07),transparent_70%)]" />

      {/* grade de embeddings */}
      <svg
        viewBox={`0 0 ${EMB_COLS * 40} ${EMB_ROWS * 48}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full opacity-70"
      >
        {Array.from({ length: EMB_COLS }, (_, c) =>
          Array.from({ length: EMB_ROWS }, (_, r) => {
            const delay = -(((c + r * 1.6) * 0.55) % 6);
            return (
              <circle
                key={`${c}-${r}`}
                cx={c * 40 + 20}
                cy={r * 48 + 24}
                r={c % 5 === 0 && r % 2 === 0 ? 2.4 : 1.5}
                fill="#C0A060"
                opacity={0.1}
                className={still ? undefined : "llm-dot"}
                style={
                  still
                    ? undefined
                    : ({ animationDelay: `${delay.toFixed(2)}s` } as CSSProperties)
                }
              />
            );
          })
        )}
      </svg>

      {/* camadas + atenção */}
      <svg
        viewBox="0 0 1000 600"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="llm-arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#755D2E" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#C0A060" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#EADAB6" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {ARCS.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="url(#llm-arc)"
            strokeWidth="1.5"
            className={still ? undefined : "llm-flow"}
            style={
              still ? undefined : ({ animationDelay: `${-(i * 0.7).toFixed(1)}s` } as CSSProperties)
            }
          />
        ))}

        {NODES.map((n) => (
          <g key={n.key}>
            <circle cx={n.cx} cy={n.cy} r="10" fill="#C0A060" opacity="0.08" />
            <circle
              cx={n.cx}
              cy={n.cy}
              r="3.5"
              fill="#C0A060"
              opacity="0.45"
              className={still ? undefined : "llm-node"}
            />
          </g>
        ))}
      </svg>

      {/* curva de aprendizado */}
      <svg
        viewBox="0 0 600 200"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-16 h-40 w-full opacity-80"
      >
        <defs>
          <linearGradient id="llm-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C0A060" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#C0A060" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 168 L600 168 L600 200 L0 200 Z"
          fill="url(#llm-area)"
          opacity="0.5"
        />
        <path
          d="M0 150 C 60 148, 90 132, 140 128 S 230 118, 280 96 S 380 84, 430 58 S 540 44, 600 30"
          fill="none"
          stroke="#C0A060"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={1}
          opacity="0.65"
          className={still ? undefined : "llm-draw"}
        />
        {!still && (
          <g>
            <circle r="4" fill="#D8B879" opacity="0.9">
              <animateMotion
                dur="7s"
                repeatCount="indefinite"
                path="M0 150 C 60 148, 90 132, 140 128 S 230 118, 280 96 S 380 84, 430 58 S 540 44, 600 30"
              />
            </circle>
          </g>
        )}
        <text
          x="596"
          y="22"
          textAnchor="end"
          fontSize="11"
          fontFamily="monospace"
          fill="#8E8E93"
          letterSpacing="1"
        >
          época 12 · erro 0.18 → 0.04
        </text>
      </svg>

      {/* tokens subindo */}
      {!still &&
        TOKEN_COLS.map((t) => (
          <span
            key={t.word}
            className={cn(
              "llm-token absolute bottom-0 rounded-full border border-accent/25 bg-bg1/60 px-2.5 py-0.5 font-mono text-accent/70 backdrop-blur-[1px]",
              t.size
            )}
            style={
              {
                left: `${t.left}%`,
                animationDuration: `${t.duration}s`,
                animationDelay: `${t.delay}s`,
              } as CSSProperties
            }
          >
            {t.word}
          </span>
        ))}
    </div>
  );
}

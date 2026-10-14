"use client";

import { useEffect, useState } from "react";
import {
  AppWindow,
  PlugZap,
  LayoutDashboard,
  Bot,
  Database,
  Sparkles,
  CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MODULES = [
  {
    icon: AppWindow,
    title: "Sistemas sob medida",
    meta: "feitos pra sua operação",
    status: "em produção",
  },
  {
    icon: PlugZap,
    title: "Integrações",
    meta: "tudo conversando",
    status: "sincronizando",
  },
  {
    icon: LayoutDashboard,
    title: "Painéis",
    meta: "tempo real",
    status: "live",
  },
  {
    icon: Bot,
    title: "Agentes IA",
    meta: "treinados na sua base",
    status: "especialista",
  },
] as const;

const TERMINAL_LINES = [
  "$ aurum deploy --prod",
  "✓ sistema no ar — ok",
  "✓ base conectada — ok",
  "✓ agente-ia sincronizado com a base",
  "● live em produção",
] as const;

/**
 * Animação custom do banner: "Console do sistema vivo".
 * Camadas: anel orbital cônico + pipeline base → IA → agente com
 * pacotes de dados em fluxo + grade de módulos + terminal com digitação.
 * Tudo decorativo, só transform/opacity/stroke-dashoffset.
 * Estático sob `prefers-reduced-motion` ou antes do mount.
 */
export function HeroSystemOrbit({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [typedCount, setTypedCount] = useState<number>(TERMINAL_LINES.length);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Digitação do terminal — loop linha a linha.
  useEffect(() => {
    if (!mounted || reduced) {
      setTypedCount(TERMINAL_LINES.length);
      return;
    }
    setTypedCount(0);
    let line = 0;
    let char = 0;
    let timer: ReturnType<typeof setTimeout>;
    const full = TERMINAL_LINES.map((l) => l.length);

    const tick = () => {
      if (line >= TERMINAL_LINES.length) {
        timer = setTimeout(() => {
          line = 0;
          char = 0;
          setTypedCount(0);
          timer = setTimeout(tick, 400);
        }, 4200);
        return;
      }
      char += 1;
      if (char >= full[line]) {
        line += 1;
        char = 0;
        setTypedCount(line);
        timer = setTimeout(tick, line >= TERMINAL_LINES.length ? 100 : 420);
      } else {
        timer = setTimeout(tick, 14 + Math.random() * 26);
      }
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [mounted, reduced]);

  const still = !mounted || reduced;
  const visibleLines = TERMINAL_LINES.slice(0, typedCount);

  return (
    <div className={cn("relative", className)} aria-hidden="true">
      {/* Halo + anel orbital cônico atrás do console */}
      <div className="sys-halo absolute left-1/2 top-[30%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl" />
      {!still && (
        <div className="sys-spin-slow absolute left-1/2 top-[30%] h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-50 [background:conic-gradient(from_0deg,transparent_0deg,rgba(192,160,96,0.14)_50deg,transparent_110deg,transparent_180deg,rgba(216,184,121,0.10)_240deg,transparent_300deg)] blur-2xl" />
      )}

      {/* Console */}
      <div className="glass-card relative overflow-hidden rounded-card">
        {/* brilho superior */}
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />

        {/* header do console */}
        <div className="flex items-center justify-between border-b border-line2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-ok/70" />
          </div>
          <p className="font-mono text-micro text-text2">
            aurumbit <span className="text-text3">•</span>{" "}
            <span className="text-ok">production — live</span>
          </p>
          <span className="badge-gold hidden font-mono text-micro sm:inline-flex">
            v2 · novo
          </span>
        </div>

        {/* pipeline base → IA → agente */}
        <div className="px-4 pt-4">
          <svg viewBox="0 0 480 172" className="h-auto w-full" role="presentation">
            <defs>
              <linearGradient id="sys-edge" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#755D2E" />
                <stop offset="50%" stopColor="#C0A060" />
                <stop offset="100%" stopColor="#EADAB6" />
              </linearGradient>
              <radialGradient id="sys-core" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="#D8B879" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#C0A060" stopOpacity="0.15" />
              </radialGradient>
            </defs>

            {/* trilhos */}
            <path
              d="M118 86 C 160 86, 170 86, 198 86"
              fill="none"
              stroke="url(#sys-edge)"
              strokeWidth="2"
              strokeOpacity="0.7"
              className={still ? undefined : "sys-flow"}
            />
            <path
              d="M282 86 C 310 86, 320 86, 362 86"
              fill="none"
              stroke="url(#sys-edge)"
              strokeWidth="2"
              strokeOpacity="0.7"
              className={still ? undefined : "sys-flow"}
            />
            {/* ramificações para módulos */}
            <path
              d="M240 86 C 240 120, 180 122, 150 132"
              fill="none"
              stroke="#C0A060"
              strokeOpacity="0.25"
              strokeWidth="1.5"
              strokeDasharray="4 6"
              className={still ? undefined : "sys-flow-slow"}
            />
            <path
              d="M240 86 C 240 120, 300 122, 330 132"
              fill="none"
              stroke="#C0A060"
              strokeOpacity="0.25"
              strokeWidth="1.5"
              strokeDasharray="4 6"
              className={still ? undefined : "sys-flow-slow"}
            />

            {/* pacotes de dados */}
            {!still && (
              <g>
                <circle r="4" fill="#D8B879">
                  <animateMotion
                    dur="2.6s"
                    repeatCount="indefinite"
                    path="M118 86 C 160 86, 170 86, 198 86"
                  />
                </circle>
                <circle r="4" fill="#EADAB6">
                  <animateMotion
                    dur="2.6s"
                    begin="1.3s"
                    repeatCount="indefinite"
                    path="M282 86 C 310 86, 320 86, 362 86"
                  />
                </circle>
                <circle r="2.6" fill="#C0A060" opacity="0.9">
                  <animateMotion
                    dur="3.4s"
                    begin="0.5s"
                    repeatCount="indefinite"
                    path="M240 86 C 240 120, 180 122, 150 132"
                  />
                </circle>
                <circle r="2.6" fill="#C0A060" opacity="0.9">
                  <animateMotion
                    dur="3.4s"
                    begin="1.9s"
                    repeatCount="indefinite"
                    path="M240 86 C 240 120, 300 122, 330 132"
                  />
                </circle>
              </g>
            )}

            {/* nó: base do cliente */}
            <g>
              <circle cx="86" cy="86" r="26" fill="url(#sys-core)" opacity="0.35" />
              <rect x="62" y="62" width="48" height="48" rx="14" fill="#0B0B0E" stroke="url(#sys-edge)" strokeWidth="2" />
              <g transform="translate(74,74)" stroke="#D8B879" strokeWidth="2" fill="none" strokeLinecap="round">
                <ellipse cx="12" cy="6" rx="9" ry="3.4" />
                <path d="M3 6 v12 c0 1.9 4 3.4 9 3.4 s9 -1.5 9 -3.4 V6" />
                <path d="M3 12 c0 1.9 4 3.4 9 3.4 s9 -1.5 9 -3.4" />
              </g>
              <text x="86" y="128" textAnchor="middle" fontSize="11" fontWeight="700" fill="#C2A878" letterSpacing="1.5">
                SUA BASE
              </text>
            </g>

            {/* nó central: IA */}
            <g>
              {!still && (
                <circle cx="240" cy="86" r="34" fill="none" stroke="#D8B879" strokeOpacity="0.5" strokeWidth="1.5" className="sys-ping" />
              )}
              <circle cx="240" cy="86" r="30" fill="#0B0B0E" stroke="url(#sys-edge)" strokeWidth="2.5" />
              <circle cx="240" cy="86" r="21" fill="url(#sys-core)" opacity="0.5" />
              <g transform="translate(228,74)" stroke="#0B0B0E" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3 h12 v10 l-3 -2 -3 2 -3 -2 -3 2 z" fill="#D8B879" stroke="none" />
                <path d="M9 17 c2 2 4 2 6 0" />
              </g>
              <text x="240" y="128" textAnchor="middle" fontSize="11" fontWeight="800" fill="#EADAB6" letterSpacing="2">
                AURUM IA
              </text>
            </g>

            {/* nó: agente especialista */}
            <g>
              <circle cx="394" cy="86" r="26" fill="url(#sys-core)" opacity="0.35" />
              <rect x="370" y="62" width="48" height="48" rx="24" fill="#0B0B0E" stroke="url(#sys-edge)" strokeWidth="2" />
              <g transform="translate(382,74)" stroke="#D8B879" strokeWidth="2" fill="none" strokeLinecap="round">
                <circle cx="12" cy="9" r="5" />
                <path d="M4 21 c1 -4 4 -6 8 -6 s7 2 8 6" />
              </g>
              <text x="394" y="128" textAnchor="middle" fontSize="11" fontWeight="700" fill="#C2A878" letterSpacing="1.5">
                AGENTE
              </text>
            </g>

            {/* selo base conectada */}
            <g transform="translate(150,142)">
              <rect x="-46" y="-11" width="92" height="22" rx="11" fill="#0B0B0E" stroke="#C0A060" strokeOpacity="0.4" />
              <text textAnchor="middle" dy="4" fontSize="10" fontFamily="monospace" fill="#4ADE80">
                ● base conectada
              </text>
            </g>
            <g transform="translate(330,142)">
              <rect x="-52" y="-11" width="104" height="22" rx="11" fill="#0B0B0E" stroke="#C0A060" strokeOpacity="0.4" />
              <text textAnchor="middle" dy="4" fontSize="10" fontFamily="monospace" fill="#D8B879">
                ◆ setor do cliente
              </text>
            </g>
          </svg>
        </div>

        {/* grade de módulos */}
        <ul className="grid grid-cols-2 gap-2 px-4 pt-2" role="list">
          {MODULES.map(({ icon: Icon, title, meta, status }, i) => (
            <li
              key={title}
              className={cn(
                "flex items-center gap-2.5 rounded-base border border-line2 bg-bg0/70 px-3 py-2.5",
                !still && (i % 2 === 0 ? "sys-float" : "sys-float sys-float-delayed")
              )}
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm border border-line1 bg-accent-soft text-accent">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-caption font-semibold text-text1">
                  {title}
                </span>
                <span className="block font-mono text-micro leading-snug text-text3">
                  {meta} • <span className="text-ok">{status}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>

        {/* terminal */}
        <div className="mx-4 mb-4 mt-3 overflow-hidden rounded-base border border-line2 bg-[#07070A]">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
            <Database className="h-3.5 w-3.5 text-accent" />
            <span className="font-mono text-micro text-neutral-400">deploy — aurumbit cloud</span>
            <span className="ml-auto flex items-center gap-1 font-mono text-micro text-ok">
              <CheckCheck className="h-3.5 w-3.5" /> stable
            </span>
          </div>
          <div className="min-h-[118px] px-3 py-2.5 font-mono text-caption leading-relaxed">
            {visibleLines.map((line, i) => (
              <p
                key={`${i}-${line}`}
                className={cn(
                  i === 0
                    ? "text-neutral-300"
                    : line.startsWith("●")
                      ? "text-accent"
                      : "text-emerald-400"
                )}
              >
                {line}
              </p>
            ))}
            {!still && typedCount < TERMINAL_LINES.length && (
              <span className="terminal-caret inline-block h-4 w-2 translate-y-0.5 bg-accent" />
            )}
          </div>
        </div>

        {/* chips flutuantes */}
        <div className="pointer-events-none absolute -right-2 top-16 hidden sm:block">
          <div className={!still ? "sys-float" : undefined}>
            <span className="glass-card flex items-center gap-1.5 px-3 py-1.5 font-mono text-micro text-text1">
              <Sparkles className="h-3.5 w-3.5 text-accent" /> tudo conectado
            </span>
          </div>
        </div>
        <div className="pointer-events-none absolute -left-2 bottom-24 hidden sm:block">
          <div className={!still ? "sys-float sys-float-delayed" : undefined}>
            <span className="glass-card flex items-center gap-1.5 px-3 py-1.5 font-mono text-micro text-text1">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> uptime 99.9%
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center font-mono text-micro text-text3">
        sistema + IA trabalhando pela sua empresa
      </p>
    </div>
  );
}

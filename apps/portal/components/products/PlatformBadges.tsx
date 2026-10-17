"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  PLATFORM_SHORT_LABELS,
  normalizePlatforms,
  platformIconSrc,
  platformLabel,
  type PlatformId,
} from "@/lib/platforms";

/**
 * Marcas de plataforma do produto — PNGs locais de `public/tags/`
 * (gerados por `tools/build-tag-icons.py` a partir de `ASSETS/tags/`).
 *
 * DS v1 §4 manda `lucide-react` para toda a UI; aqui há um OVERRIDE
 * REGISTRADO do usuário, válido só para estas marcas de plataforma (um
 * `Monitor` genérico não diz "Windows"). O resto do DS continua lei: o PNG é
 * DECORATIVO (`alt=""`) e o nome pt-BR vive em texto ao lado — nada de
 * depender de hover, nada de emoji, cores do texto via `var(--*)`.
 *
 * Tema: só a Apple é monocromática (preta) e por isso tem variante `-dark`.
 * O padrão do site é dark, então o SSR já renderiza a variante escura e o
 * toggle do tema troca o `src` sem mismatch de hidratação (mesmo padrão de
 * `components/sections/Products.tsx`).
 */

interface PlatformMarkProps {
  id: PlatformId;
  /** 14 | 16 | 20 — grade canônica do DS §4. */
  size?: 14 | 16 | 20;
  className?: string;
}

export function PlatformMark({ id, size = 16, className }: PlatformMarkProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || resolvedTheme !== "light";

  return (
    <Image
      src={platformIconSrc(id, dark)}
      alt=""
      width={size}
      height={size}
      // Sem `sizes`: o Next só respeita `sizes` com unidade `vw` e cairia no
      // candidato de 3840px. Sem `sizes` + `width` numérico, o Next gera o
      // srcset canônico 1x/2x (16w/32w) — o tamanho certo para um ícone fixo.
      className={cn("shrink-0", className)}
    />
  );
}

/** Pastilha de plataforma — `border-line2` + `bg-bg2` (tokens, sem hex). */
const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-line2 bg-bg2 px-1.5 py-0.5";

export interface PlatformBadgesProps {
  /**
   * Slugs do produto. Aceita lista tolerante de propósito: pode vir de
   * `ProductView.platforms` (já normalizado) ou de cache/mock cru — quem
   * decide o que é válido é `normalizePlatforms`.
   */
  platforms?: readonly string[] | null;
  /** `full` (modal, rótulo completo) | `short` (card, rótulo curto). */
  labels?: "full" | "short";
  className?: string;
  /**
   * O que renderizar quando o produto não declara plataforma alguma.
   * `null` = não renderiza nada (honesto e silencioso — usado no card).
   */
  empty?: ReactNode | null;
}

export function PlatformBadges({
  platforms,
  labels = "full",
  className,
  empty = null,
}: PlatformBadgesProps) {
  const list = normalizePlatforms(platforms);

  // Sem plataforma declarada: NUNCA mostrar todas, NUNCA inferir do SO do
  // visitante. O chamador decide se cala (card, densidade) ou diz que não sabe
  // (modal, visão de detalhe).
  if (list.length === 0) return <>{empty}</>;

  const textFor = (id: PlatformId) =>
    labels === "full" ? platformLabel(id) : PLATFORM_SHORT_LABELS[id];

  return (
    <ul
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="list"
      aria-label="Plataformas suportadas"
    >
      {list.map((id) => (
        <li key={id} className={CHIP}>
          <PlatformMark id={id} size={labels === "full" ? 16 : 14} />
          <span className="text-micro font-semibold text-text2">{textFor(id)}</span>
        </li>
      ))}
    </ul>
  );
}

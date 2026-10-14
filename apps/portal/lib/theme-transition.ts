/**
 * Transição de tema Dark/Light da landpage.
 *
 * Estratégia em três camadas (primeiro match vence):
 * 1. Vidro (`lib/theme-glass.ts`, ~1130ms): véu fosco sobre o tema antigo,
 *    reveal circular do botão via View Transitions, dissipação do véu.
 *    Glass e fallback nunca juntos.
 * 2. View Transitions API (Chromium/Safari 18+): reveal circular (~1050ms).
 * 3. Fallback: classe `html.theme-animating` (~950ms), que interpola SÓ
 *    propriedades de tinta (background/border/color/fill/stroke).
 *    transform/opacity/filter/backdrop-filter ficam de fora de propósito: o
 *    compositor segue livre (orbes, drawers framer-motion e o ícone Sol/Lua
 *    rodam sem jank, até 120Hz onde o display permite).
 *
 * `prefers-reduced-motion: reduce` ou `forced-colors: active` = corte seco.
 */

import { isThemeGlassAvailable, playThemeGlass } from "./theme-glass";

export interface ThemeTransitionOrigin {
  x: number;
  y: number;
}

export interface RunThemeTransitionOptions {
  /** Ponto de origem do reveal (centro do toggle). Sem ele, parte do centro da tela. */
  origin?: ThemeTransitionOrigin | null;
  /** Duração do fallback com classe (ms). Deve espelhar o CSS. */
  fallbackDuration?: number;
  /** Duração do reveal circular via View Transitions (ms). */
  viewTransitionDuration?: number;
}

export const THEME_FALLBACK_DURATION = 950;
export const THEME_VT_DURATION = 1050;
/** Expo-out padrão do DS (mesma curva das entradas de seção). */
export const THEME_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Tipagem estrutural local — evita aumentar o lib.dom global. */
type ViewTransitionLike = {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function prefersForcedColors(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(forced-colors: active)").matches;
}

/** Centro do elemento clicado, em coordenadas de viewport (o que o clip-path usa). */
export function getThemeTransitionOrigin(el: HTMLElement | null): ThemeTransitionOrigin | null {
  if (!el || typeof window === "undefined") return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export async function runThemeTransition(
  update: () => void | Promise<void>,
  options: RunThemeTransitionOptions = {},
): Promise<void> {
  const {
    origin = null,
    fallbackDuration = THEME_FALLBACK_DURATION,
    viewTransitionDuration = THEME_VT_DURATION,
  } = options;

  if (typeof document === "undefined") {
    await update();
    return;
  }

  // Movimento reduzido ou alto contraste: troca instantânea, sem animação.
  if (prefersReducedMotion() || prefersForcedColors()) {
    await update();
    return;
  }

  // Vidro: substitui o reveal circular quando disponível.
  // Nunca roda junto com View Transitions (mutuamente exclusivos).
  if (isThemeGlassAvailable()) {
    try {
      await playThemeGlass(update, origin ?? null);
    } catch {
      // playThemeGlass nunca rejeita nem deixa a troca sem aplicar;
      // este catch é cinturão extra: garante a troca e segue.
      try {
        await update();
      } catch {
        // update idempotente (setTheme); nada a fazer.
      }
    }
    return;
  }

  const doc = document as DocumentWithViewTransition;

  if (typeof doc.startViewTransition === "function") {
    let transition: ViewTransitionLike | null = null;
    try {
      transition = doc.startViewTransition(() => update());
    } catch {
      transition = null;
    }
    if (transition) {
      try {
        await transition.ready;
        const x = origin?.x ?? window.innerWidth / 2;
        const y = origin?.y ?? window.innerHeight / 2;
        const endRadius = Math.hypot(
          Math.max(x, window.innerWidth - x),
          Math.max(y, window.innerHeight - y),
        );
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          { duration: viewTransitionDuration, easing: THEME_EASING, pseudoElement: "::view-transition-new(root)" },
        );
        await transition.finished;
      } catch {
        // Snapshot já aplicado pelo callback; nada a desfazer.
      }
      return;
    }
  }

  // Fallback: interpola os tokens via CSS enquanto a classe vive.
  const root = document.documentElement;
  const w = window as unknown as { __aurumThemeTimeout?: number };
  if (w.__aurumThemeTimeout) window.clearTimeout(w.__aurumThemeTimeout);
  root.classList.add("theme-animating");
  // Reflow força o navegador a enxergar a classe ANTES da troca de tokens.
  void root.offsetWidth;
  try {
    await update();
  } finally {
    await new Promise<void>((resolve) => {
      w.__aurumThemeTimeout = window.setTimeout(() => {
        root.classList.remove("theme-animating");
        resolve();
      }, fallbackDuration + 80);
    });
  }
}

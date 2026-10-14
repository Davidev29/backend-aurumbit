/**
 * Transição de tema em vidro (glass) da landpage — elegante e sofisticada.
 *
 * Desenho anti-clarão (seguro p/ sensibilidade à luz): a troca claro↔escuro
 * NUNCA acontece num corte visível. O véu fosco fecha devagar sobre o tema
 * antigo, a troca ocorre sob cobertura total e o reveal abre com arranque
 * suave (ease-in-out, sem onset brusco) e se dissipa devagar. Sem piscadas,
 * sem flashes fullscreen, sem saltos de luminância num único frame.
 *
 * Coreografia (~2150ms, a partir do botão):
 * 1. Véu fosco denso (450ms, ease): congela a página num vidro fosco.
 * 2. Revelação (1200ms, ease-in-out suave): `document.startViewTransition(
 *    () => update())` com clip circular que cresce do botão. A troca acontece
 *    atrás do vidro, sem aresta dura e sem flash.
 * 3. Assentamento (500ms): SÓ após o reveal completo o véu derrete devagar;
 *    a promessa resolve em seguida — sem corte seco no final.
 *
 * Sem canvas, sem partículas, sem glow, sem camada colorida: só vidro.
 * Nunca rejeita; o tema é aplicado pelo callback do VT.
 * Kill-switch: `NEXT_PUBLIC_THEME_GLASS=0`.
 */

export interface ThemeGlassOrigin {
  x: number;
  y: number;
}

/** Desligado com `NEXT_PUBLIC_THEME_GLASS=0`. Padrão: ligado. */
export const THEME_GLASS_ENABLED = process.env.NEXT_PUBLIC_THEME_GLASS !== "0";

export const GLASS_IN_MS = 450;
export const GLASS_REVEAL_MS = 1200;
export const GLASS_OUT_MS = 500;
export const GLASS_DURATION = GLASS_IN_MS + GLASS_REVEAL_MS + GLASS_OUT_MS;
/** Segurança visual (limpeza), nunca reaplica tema. */
const GLASS_SAFETY_TIMEOUT = 3200;

export type GlassPhase = "veil-in" | "reveal" | "veil-out" | "done";

export function getGlassPhaseAt(t: number): GlassPhase {
  if (t < GLASS_IN_MS) return "veil-in";
  if (t < GLASS_IN_MS + GLASS_REVEAL_MS) return "reveal";
  if (t < GLASS_DURATION) return "veil-out";
  return "done";
}

type NavigatorWithMemory = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

export function isThemeGlassAvailable(): boolean {
  if (!THEME_GLASS_ENABLED) return false;
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof requestAnimationFrame !== "function") return false;
  try {
    const doc = document as Document & {
      startViewTransition?: (update: () => void | Promise<void>) => unknown;
    };
    if (typeof doc.startViewTransition !== "function") return false;
  } catch {
    return false;
  }
  try {
    if (window.location.pathname !== "/") return false;
  } catch {
    return false;
  }
  if (typeof window.matchMedia !== "function") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.matchMedia("(forced-colors: active)").matches) return false;
  if (window.matchMedia("(prefers-reduced-transparency: reduce)").matches) return false;
  if (document.visibilityState !== "visible") return false;
  try {
    if ((navigator as NavigatorWithMemory).connection?.saveData) return false;
  } catch {
    return false;
  }
  return true;
}

interface ViewTransitionLike {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  skipTransition(): void;
}

/**
 * Executa a transição em vidro e resolve ao limpar tudo.
 * NUNCA rejeita; o tema é aplicado pelo callback do VT.
 */
export function playThemeGlass(
  update: () => void | Promise<void>,
  origin?: ThemeGlassOrigin | null,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let rafId = 0;
    let safetyId = 0;
    let veil: HTMLDivElement | null = null;
    let holder: Animation | null = null;

    const cleanup = () => {
      try {
        cancelAnimationFrame(rafId);
      } catch {
        // ambiente sem rAF (teste): nada a cancelar.
      }
      if (safetyId) {
        clearTimeout(safetyId);
        safetyId = 0;
      }
      if (holder) {
        try {
          holder.cancel();
        } catch {
          // cancel best-effort.
        }
        holder = null;
      }
      try {
        window.removeEventListener("resize", handleResize);
        document.removeEventListener("visibilitychange", handleVisibility);
      } catch {
        // listeners podem não existir em ambiente de teste.
      }
      if (veil) {
        try {
          veil.remove();
        } catch {
          // remoção best-effort.
        }
        veil = null;
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const handleResize = () => undefined;
    const handleVisibility = () => {
      try {
        if (document.visibilityState === "hidden") {
          try {
            transitionRef?.skipTransition();
          } catch {
            // skip best-effort.
          }
          finish();
        }
      } catch {
        finish();
      }
    };

    let transitionRef: ViewTransitionLike | null = null;

    // Origem (fallback: centro, unificado com o VT legado).
    let W = 0;
    let H = 0;
    let cx = 0;
    let cy = 0;
    try {
      W = window.innerWidth;
      H = window.innerHeight;
      cx = Math.min(Math.max(origin?.x ?? W / 2, 0), W);
      cy = Math.min(Math.max(origin?.y ?? H / 2, 0), H);
    } catch {
      finish();
      return;
    }
    const endRadius = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 24;

    const doc = document as Document & {
      startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
    };
    try {
      if (typeof doc.startViewTransition !== "function") throw new Error("no-vt");
    } catch {
      try {
        const r = update();
        if (r instanceof Promise) r.catch(() => undefined);
      } catch {
        // update idempotente.
      }
      finish();
      return;
    }

    try {
      veil = document.createElement("div");
      veil.className = "theme-glass-veil";
      veil.setAttribute("aria-hidden", "true");
      document.body.appendChild(veil);
      // Reflow: o navegador enxerga o véu antes do fade-in.
      void veil.offsetWidth;
      veil.dataset.on = "1";
      window.addEventListener("resize", handleResize);
      document.addEventListener("visibilitychange", handleVisibility);
      safetyId = window.setTimeout(() => {
        try {
          transitionRef?.skipTransition();
        } catch {
          // skip best-effort.
        }
        finish();
      }, GLASS_SAFETY_TIMEOUT);
    } catch {
      try {
        const r = update();
        if (r instanceof Promise) r.catch(() => undefined);
      } catch {
        // update idempotente.
      }
      finish();
      return;
    }

    const t0 = performance.now();

    const pseudoAnimate = (
      keyframes: Keyframe[],
      options: { duration: number; easing: string; fill: "both"; pseudoElement: string },
    ): Animation | null => {
      try {
        return document.documentElement.animate(
          keyframes,
          options as unknown as KeyframeAnimationOptions,
        );
      } catch {
        return null;
      }
    };

    // Espera o véu fechar sobre o tema antigo antes de trocar.
    const wait = (ms: number) =>
      new Promise<void>((res) => {
        const start = performance.now();
        const tick = () => {
          if (settled) return res();
          if (performance.now() - start >= ms) return res();
          try {
            rafId = requestAnimationFrame(() => tick());
          } catch {
            res();
          }
        };
        tick();
      });

    (async () => {
      try {
        await wait(GLASS_IN_MS);
        if (settled) return;
        let transition: ViewTransitionLike | null = null;
        try {
          const startVT = doc.startViewTransition;
          if (typeof startVT !== "function") throw new Error("no-vt");
          transition = startVT(() => update());
          transitionRef = transition;
        } catch {
          transition = null;
        }
        if (!transition) {
          try {
            const r = update();
            if (r instanceof Promise) r.catch(() => undefined);
          } catch {
            // update idempotente.
          }
          finish();
          return;
        }
        try {
          await transition.ready;
        } catch {
          finish();
          return;
        }
        if (settled) return;
        const anim = pseudoAnimate(
          [
            { clipPath: `circle(0px at ${cx}px ${cy}px)` },
            { clipPath: `circle(${Math.ceil(endRadius)}px at ${cx}px ${cy}px)` },
          ],
          {
            duration: GLASS_REVEAL_MS,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            fill: "both",
            pseudoElement: "::view-transition-new(root)",
          },
        );
        if (!anim) {
          try {
            transition.skipTransition();
          } catch {
            // skip best-effort.
          }
          finish();
          return;
        }
        holder = anim;
        // Assentamento: o véu só começa a sair DEPOIS do reveal completo,
        // derrete por GLASS_OUT_MS e a promessa só resolve em seguida —
        // sem corte seco no final.
        void Promise.race([
          anim.finished.catch(() => undefined),
          new Promise((res) => setTimeout(res, GLASS_REVEAL_MS + 200)),
        ])
          .then(async () => {
            if (settled || !veil) {
              finish();
              return;
            }
            try {
              veil.dataset.on = "0";
            } catch {
              // estilo best-effort.
            }
            await wait(GLASS_OUT_MS);
            finish();
          })
          .catch(() => finish());
      } catch {
        finish();
      }
    })();
  });
}

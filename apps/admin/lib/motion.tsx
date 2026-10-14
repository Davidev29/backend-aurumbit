"use client";

import { MotionConfig, type Variants } from "framer-motion";

/**
 * Motion DS §6. Durações em ms (teto 400; saída = 75% da entrada).
 * Só `transform` + `opacity` (60fps). Nada de width/height/top/left.
 */
export const DUR = { instant: 100, fast: 160, medium: 240, slow: 360 } as const;

/** Easings DS §6: out = default de entrada; in-out = troca de estado; in = SÓ saída. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;
/** Alias legado. */
export const EASE_INOUT = EASE_IN_OUT;

const s = (ms: number) => ms / 1000;

/** Modal/dialog: scale + fade + y (entrada out 240ms, saída in 180ms). */
export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 16 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: s(DUR.medium), ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: s(DUR.medium * 0.75), ease: EASE_IN } },
};

/** Drawer lateral: anima `x` (transform), NUNCA width. */
export const slideOver: Variants = {
  hidden: { opacity: 0, x: 320 },
  show: { opacity: 1, x: 0, transition: { duration: s(DUR.medium), ease: EASE_OUT } },
  exit: { opacity: 0, x: 320, transition: { duration: s(DUR.medium * 0.75), ease: EASE_IN } },
};

/** Dropdown/menu/popover: fade + shift 8px, 160ms, sem spring. */
export const fadeShift: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: s(DUR.fast), ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, transition: { duration: 0.12, ease: EASE_IN } },
};

/** QR/avatar/badge novo: pop 160ms. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: s(DUR.fast), ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.12, ease: EASE_IN } },
};

/** Backdrop de modal/drawer: só opacidade (nunca anima valor de blur). */
export const backdropVar: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: s(DUR.fast) } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};
/** Alias canônico (04 §4). */
export const backdrop: Variants = backdropVar;

/** Transição de página: fade + rise sutil, sem slide lateral. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: s(DUR.medium), ease: EASE_IN_OUT } },
};

/** Lista: stagger só nos 8 primeiros, resto instant (ver uso canônico em 04 §4). */
export const staggerList: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: s(DUR.fast), ease: EASE_OUT } },
};

/** Erro form/MFA (opt-in): shake 4px, 300ms, 2 ciclos + foco no campo. */
export const shake = {
  animate: { x: [0, -4, 4, -4, 0], transition: { duration: 0.3, ease: EASE_IN_OUT } },
};

/**
 * layout/layoutId permitidos em EXATAMENTE 2 lugares (DS §6):
 * pill do item ativo da sidebar (`sidebar-active-pill`) e underline de tab
 * ativa (`tab-underline`). Todo o resto: `layout={false}` explícito.
 */
export const ALLOWED_LAYOUT_IDS = ["sidebar-active-pill", "tab-underline"] as const;

/** Provedor global: respeita `prefers-reduced-motion` (DS §6). */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

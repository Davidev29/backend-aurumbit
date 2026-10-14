/**
 * Helpers centrais de rolagem suave — 1 comportamento para a landpage toda.
 * Respeita `prefers-reduced-motion` (troca seca só nesse caso).
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollToTop(): void {
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

export function scrollToSelector(selector: string, block: ScrollLogicalPosition = "start"): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block });
}

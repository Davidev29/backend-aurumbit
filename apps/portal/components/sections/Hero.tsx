"use client";

import { HeroLiquidBrand } from "./HeroLiquidBrand";

/**
 * Hero da landpage: logomarca líquida persistente + palavras digitadas
 * (`HeroLiquidBrand`, seção própria com o H1).
 * O `id="hero"` fica no wrapper para preservar a âncora e o `scroll-margin`
 * do header fixo.
 */
export function Hero() {
  return (
    <div id="hero" style={{ scrollMarginTop: 76 }}>
      <HeroLiquidBrand />
    </div>
  );
}

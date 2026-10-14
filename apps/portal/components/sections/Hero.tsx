"use client";

import { HeroLiquidBrand } from "./HeroLiquidBrand";
import { TrustBar } from "./TrustBar";

/**
 * Hero da landpage: logomarca líquida persistente + palavras digitadas
 * (`HeroLiquidBrand`, seção própria com o H1) + faixa de confiança abaixo.
 * O `id="hero"` fica no wrapper para preservar a âncora e o `scroll-margin`
 * do header fixo.
 */
export function Hero() {
  return (
    <div id="hero" style={{ scrollMarginTop: 76 }}>
      <HeroLiquidBrand />
      <TrustBar />
    </div>
  );
}

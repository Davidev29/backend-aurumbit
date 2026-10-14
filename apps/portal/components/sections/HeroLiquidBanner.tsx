"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import SculptureHero from "@/components/ui/liquid-sculpture-hero";

/**
 * Banner principal da landpage — AurumBit sobre o motor liquid-sculpture.
 *
 * O material líquido É a palavra "aurum": dois SVGs estáticos em /public
 * (texto dourado sobre fundo transparente, mesma origem = zero CORS/CSP).
 * O motor amostra por alfa — partículas existem só nos glifos e a cor do
 * glifo passa intacta (uTint=1).
 *
 * Camadas do banner (fundo → frente): foto `/fundo-banner.jpg` (cover,
 * todos os tamanhos) → véu do tema (legibilidade + fusão com a página) →
 * vidro glasmorphism suave (blur 9px, respeita reduced-transparency e
 * forced-colors) → palavra-partícula com sombra suave sobre o vidro.
 * Foto e vidro têm pointer-events:none — a interação passa para o motor.
 *
 * Paleta (valores = tokens runtime de globals.css, unificados no DESIGN.md):
 *
 * | Papel            | Light              | Dark               |
 * |------------------|--------------------|--------------------|
 * | Fundo do banner  | `#F7F4ED` (`--bg-0`)| `#090806` (`--bg-0`)|
 * | Texto            | `#14161A` (`--text-1`)| `#F5F5F4` (`--text-1`)|
 * | Acento = cor da palavra | `#755D2E` (`--accent`) | `#C0A060` (`--accent`) |
 *
 * Decisões (pós-avaliação multiagente design/WebGL/a11y):
 * - `showNav={false}` + `themeToggle={false}` — Navbar do portal é dona.
 * - `backdropText=""` — sem eco fantasma atrás da palavra-partícula.
 * - `sculptureScale 0.9` / `mobileSculptureScale 0.5` — palavra larga
 *   (~3.5:1) sem bleed no desktop e sem corte no mobile.
 * - `streaks={false}` + `returnSpeed 1.2` — a palavra continua legível
 *   durante a interação e se remonta rápido.
 * - `loadFonts={false}` — CSP (`font-src 'self'`) + fontes do DS.
 * - `interactive={!reduceMotion}` — reduced-motion real: palavra estática
 *   nítida (o motor sozinho só atenuava, mantinha o loop).
 * - `showCredit={false}` — sem link externo no hero.
 * - Mobile usa o mesmo SVG (activeSrc estável → sem recarga ao cruzar
 *   breakpoint; sem variantes portrait — não há "celular" a adaptar).
 */
export function HeroLiquidBanner() {
  const { resolvedTheme } = useTheme();
  // Guarda de montagem (padrão next-themes): o SSR sempre renderiza "dark".
  // Sem isso, clientes light hidratariam com --sh-bg/imagem diferentes.
  // Após o mount, a troca usa o fade interno do motor (data-swap).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const mode = mounted && resolvedTheme === "light" ? "light" : "dark";

  // Reduced-motion real: sem ponteiros, sem rAF — só a palavra nítida.
  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return (
    <SculptureHero
      // — Word-art estática, determinística no SSR (sem mismatch) —
      src="/aurum-liquid-light.svg"
      mobileSrc="/aurum-liquid-light.svg"
      darkSrc="/aurum-liquid-dark.svg"
      mobileDarkSrc="/aurum-liquid-dark.svg"
      imageAlt="Palavra Aurum em dourado, decorativa"
      // imgBg ausente de propósito: SVG transparente usa o caminho alfa.
      // — Tema sincronizado com o next-themes do portal —
      theme={mode}
      themeToggle={false}
      showNav={false}
      background="#F7F4ED"
      darkBackground="#090806"
      textColor={mode === "dark" ? "#F5F5F4" : "#14161A"}
      accentColor={mode === "dark" ? "#C0A060" : "#755D2E"}
      // — Tipografia do design system (sem fetch externo) —
      loadFonts={false}
      headingFont="var(--font-display)"
      accentFont="var(--font-display)"
      bodyFont="var(--font-sans)"
      // — Copy PT-BR (tom DESIGN.md: simples, direto, sem jargão) —
      eyebrow="Software sob medida + IA aplicada ao seu negócio"
      headline={"Sistemas que colocam\nsua empresa no padrão."}
      headlineAccent="no padrão."
      body="Desenvolvemos sistemas, painéis, integrações e automações com a tecnologia certa para cada caso — e treinamos agentes de IA especialistas no seu setor, conectados direto à base da sua empresa."
      primaryCta={{ label: "Ver sistemas e serviços", href: "#produtos" }}
      secondaryCta={{ label: "Criar meu agente IA", href: "#ia-especialistas" }}
      hint="Passe o cursor pela palavra"
      hintTouch="Toque na palavra"
      backdropText=""
      showCredit={false}
      height="100svh"
      style={{ minHeight: 620 }}
      // — Física do material —
      interactive={!reduceMotion}
      strength={1}
      radius={220}
      sculptureScale={0.9}
      mobileSculptureScale={0.5}
      particleDensity={1.25}
      dotSize={1.2}
      particleSpread={1}
      turbulence={1}
      liquid={1}
      streaks={false}
      restStyle="image"
      returnSpeed={1.2}
      ambient={false}
      ambientIntensity={1}
      speed={1}
      intro={false}
    />
  );
}

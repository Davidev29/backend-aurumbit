"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { LiquidMarkStage } from "@/components/ui/LiquidMarkStage";
import { LiquidTypeStage } from "@/components/ui/LiquidTypeStage";
import { TypedWords } from "@/components/ui/TypedWords";
import { measureWordUnit, renderLiquidH1Image, renderLiquidMarkImage } from "@/lib/word-art";
import { scrollToSelector } from "@/lib/scroll";

/**
 * Banner principal — typing E líquido como UMA interação só:
 *
 * - LOGO: motor próprio turbinado (density 1.5, strength 1.35, raio 190) com
 *   1 imagem que NUNCA troca — a logo não some.
 * - PALAVRAS: cada tecla desenha o prefixo no canvas persistente e faz
 *   upload síncrono (`setCanvas`): o char nasce já como partícula e reage ao
 *   cursor desde o início. Delete reverso simétrico. Sem crossfade, sem dip.
 * - H1: motor próprio com quadro persistente (2 linhas, branco + ouro).
 *   O H1 real segue no DOM em `sr-only` (SEO/leitores); o canvas é decorativo.
 * - `prefers-reduced-motion`: coluna estática (ícone + palavras instantâneas
 *   + H1 em texto, sem motores).
 */

export const HERO_WORDS = [
  "Inovação",
  "Tecnologia",
  "Inteligência Artificial",
  "Automação",
  "Eficiência",
  "Transformação Digital",
  "Dados",
  "Estratégia",
  "Performance",
  "Escala",
  "Crescimento",
  "Futuro",
  "Otimização",
  "Precisão",
  "Velocidade",
  "Segurança",
  "Soluções sob medida",
  "Conexão",
  "Resultados",
] as const;

const H1_TEXT = "Sistemas que colocam sua empresa no padrão.";
const TYPE_MS = 80;
const TYPE_HOLD_MS = 2400;
const DEL_MS = 32;
const DEL_GAP_MS = 350;

export function HeroLiquidBrand() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const mode = mounted && resolvedTheme === "light" ? "light" : "dark";
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const [markSrc, setMarkSrc] = React.useState<string | null>(null);
  const [uni, setUni] = React.useState<number | null>(null);
  const [h1Src, setH1Src] = React.useState<string | null>(null);

  // Arte: símbolo 1x (independe de tema); palavras + H1 por tema (ouro light/dark).
  React.useEffect(() => {
    if (!mounted) return;
    let alive = true;
    const mark = renderLiquidMarkImage();
    if (alive && mark) setMarkSrc(mark);
    return () => {
      alive = false;
    };
  }, [mounted]);

  const theme: "light" | "dark" = mode;
  React.useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    const gen = async () => {
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => window.setTimeout(resolve, 1200)),
        ]);
      } catch {
        /* segue com fallback do sistema */
      }
      if (cancelled) return;
      setUni(measureWordUnit(HERO_WORDS));
      setH1Src(renderLiquidH1Image(theme));
    };
    gen();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, theme]);

  // Máquina unificada: digita (cada tecla já é partícula) → segura →
  // apaga em reverso → próxima. Sem fases separadas DOM/líquido.
  const [wi, setWi] = React.useState(0);
  const [chars, setChars] = React.useState(0);
  const [deleting, setDeleting] = React.useState(false);
  const [live, setLive] = React.useState<string>(HERO_WORDS[0]);
  const word = HERO_WORDS[wi];

  React.useEffect(() => {
    if (reduce || !mounted || uni == null) return;
    if (!deleting) {
      if (chars < word.length) {
        const id = window.setTimeout(
          () => {
            const next = chars + 1;
            setChars(next);
            if (next === word.length) setLive(word);
          },
          chars === 0 ? 350 : TYPE_MS
        );
        return () => window.clearTimeout(id);
      }
      const id = window.setTimeout(() => setDeleting(true), TYPE_HOLD_MS);
      return () => window.clearTimeout(id);
    }
    if (chars > 0) {
      const id = window.setTimeout(() => setChars(chars - 1), DEL_MS);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      setWi((i) => (i + 1) % HERO_WORDS.length);
      setChars(0);
      setDeleting(false);
    }, DEL_GAP_MS);
    return () => window.clearTimeout(id);
  }, [wi, chars, deleting, reduce, mounted, uni, word]);

  // Boot: entrada única do hero (máscara o aquecimento dos motores).
  // Só JS (sem-JS = visível direto) + teto de 2.5s contra fontes travadas.
  const [booted, setBooted] = React.useState(false);
  React.useEffect(() => {
    if (reduce || uni != null) setBooted(true);
  }, [reduce, uni]);
  React.useEffect(() => {
    const t = window.setTimeout(() => setBooted(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  const go = (selector: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToSelector(selector);
  };

  const bootAnim = {
    initial: { opacity: 0, y: 14 },
    animate: booted ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
  };

  // Movimento reduzido: hero estático, sem motores.
  if (reduce) {
    return (
      <section className="hero-brand" aria-label="Apresentação AurumBit">
        <div className="hero-brand-photo" aria-hidden="true">
          <img src="/fundo-banner.jpg" alt="" width={720} height={404} draggable={false} />
        </div>
        <div className="hero-brand-veil" aria-hidden="true" />
        <div className="hero-brand-glass" aria-hidden="true" />
        <div className="hero-brand-inner container-portal">
          <div className="hero-liquid-grid">
            <div className="hero-liquid-stage">
              <img
                src="/icon-192.png"
                alt="Símbolo AurumBit"
                width={320}
                height={320}
                className="liquid-mark"
                draggable={false}
              />
            </div>
            <div className="hero-liquid-copy">
              <p className="hero-brand-eyebrow">Software sob medida + IA aplicada ao seu negócio</p>
              <TypedWords words={HERO_WORDS} />
              <h1 className="hero-brand-h1">
                Sistemas que colocam
                <br />
                sua empresa <span className="text-accent">no padrão.</span>
              </h1>
              <p className="hero-brand-body">
                Desenvolvemos sistemas, painéis, integrações e automações com a tecnologia certa
                para cada caso — e treinamos agentes de IA especialistas no seu setor, conectados
                direto à base da sua empresa.
              </p>
              <div className="hero-brand-ctas">
                <a
                  className="btn-primary inline-flex min-h-[48px] items-center gap-2 rounded-base px-6 text-body font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
                  href="#produtos"
                  onClick={go("#produtos")}
                >
                  Ver sistemas e serviços
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </a>
                <a
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-base border border-line2 px-6 text-body font-medium text-text1 transition-[background-color,border-color,color] duration-150 hover:bg-bg2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  href="#ia-especialistas"
                  onClick={go("#ia-especialistas")}
                >
                  Criar meu agente IA
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="hero-brand" aria-label="Apresentação AurumBit">
      <div className="hero-brand-photo" aria-hidden="true">
        <img src="/fundo-banner.jpg" alt="" width={720} height={404} draggable={false} />
      </div>
      <div className="hero-brand-veil" aria-hidden="true" />
      <div className="hero-brand-glass" aria-hidden="true" />

      <div className="hero-brand-inner container-portal">
        <motion.div
          className="hero-liquid-grid"
          initial={bootAnim.initial}
          animate={bootAnim.animate}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="hero-liquid-stage">
            {markSrc ? (
              <LiquidMarkStage
                src={markSrc}
                className="liquid-mark"
                density={1.5}
                strength={1.35}
                radius={190}
                dotSize={1.2}
                returnSpeed={1.1}
                startupDelay={80}
              />
            ) : (
              <img
                src="/icon-192.png"
                alt=""
                width={384}
                height={384}
                className="liquid-mark"
                draggable={false}
              />
            )}
            <p className="aurum-hint" aria-hidden="true">
              <span className="aurum-hint-dot" />
              passe o cursor pela logo
            </p>
          </div>

          <div className="hero-liquid-copy">
            <p className="hero-brand-eyebrow">Software sob medida + IA aplicada ao seu negócio</p>

            {/* Palavra: typing e líquido numa interação só.
                O palco desenha o prefixo atual; o sizer invisível (mesma
                métrica via cqw) posiciona o caret; live region anuncia. */}
            <div className="liquid-word-wrap">
              <LiquidTypeStage
                text={word.slice(0, chars)}
                uni={uni}
                theme={mode}
                startupDelay={240}
                className="liquid-type"
              />
              <span
                className="word-sizer"
                aria-hidden="true"
                style={uni != null ? { fontSize: `${uni / 16}cqw` } : undefined}
              >
                <span className="word-sizer-text">{word.slice(0, chars)}</span>
                <span className="type-caret" />
              </span>
              <span className="sr-only" aria-live="polite">
                {live}
              </span>
            </div>

            {/* H1 líquido persistente + H1 real em sr-only.
                O fallback em texto existe sempre (escondido fora de
                forced-colors) para alto contraste. */}
            <h1 className="sr-only">{H1_TEXT}</h1>
            <div className="liquid-h1-wrap" data-ready={h1Src ? "1" : undefined}>
              <p className="hero-brand-h1 liquid-h1-fallback" aria-hidden="true">
                Sistemas que colocam
                <br />
                sua empresa <span className="text-accent">no padrão.</span>
              </p>
              {h1Src ? (
                <LiquidMarkStage
                  src={h1Src}
                  aspect={1600 / 340}
                  density={0.95}
                  strength={0.85}
                  radius={160}
                  startupDelay={400}
                  className="liquid-h1"
                />
              ) : null}
            </div>

            <p className="hero-brand-body">
              Desenvolvemos sistemas, painéis, integrações e automações com a tecnologia certa
              para cada caso — e treinamos agentes de IA especialistas no seu setor, conectados
              direto à base da sua empresa.
            </p>
            <div className="hero-brand-ctas">
              <a
                className="btn-primary inline-flex min-h-[48px] items-center gap-2 rounded-base px-6 text-body font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
                href="#produtos"
                onClick={go("#produtos")}
              >
                Ver sistemas e serviços
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
              <a
                className="inline-flex min-h-[48px] items-center gap-2 rounded-base border border-line2 px-6 text-body font-medium text-text1 transition-[background-color,border-color,color] duration-150 hover:bg-bg2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                href="#ia-especialistas"
                onClick={go("#ia-especialistas")}
              >
                Criar meu agente IA
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

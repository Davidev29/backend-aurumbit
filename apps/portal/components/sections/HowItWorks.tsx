"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { scrollToSelector } from "@/lib/scroll";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import { CreditCard, KeyRound, Laptop, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;
const AUTOPLAY_MS = 6000;

const steps = [
  {
    id: "plano",
    number: "01",
    icon: CreditCard,
    short: "Escolha e pague",
    title: "Escolha o plano e pague",
    description:
      "Pix, boleto ou cartão, com o total e as condições escritos antes de você confirmar.",
    details: [
      "Pix, boleto ou cartão",
      "Total à vista antes de confirmar",
      "Pagamento em ambiente seguro",
    ],
  },
  {
    id: "chave",
    number: "02",
    icon: KeyRound,
    short: "Receba a chave",
    title: "Receba a chave de ativação",
    description:
      "Liberada logo após a confirmação do pagamento, com o passo a passo para instalar.",
    details: [
      "Chave após a confirmação do pagamento",
      "Passo a passo simples junto",
      "Vale para os computadores do seu plano",
    ],
  },
  {
    id: "instalar",
    number: "03",
    icon: Laptop,
    short: "Instale e use",
    title: "Instale e volte ao trabalho",
    description: "Instale nos computadores do seu plano e use com ou sem internet.",
    details: [
      "1 computador no Base, 3 no Pro, 50 ou mais no Enterprise",
      "Funciona sem internet por dias (7 dias Base/Pro, 30 dias Enterprise)",
      "Ajuda em português se travar em algo",
    ],
  },
];

/**
 * "Do pagamento ao trabalho" — stepper de fluxo interativo.
 * O usuário percorre os passos (clique/toque); o trilho preenche em tempo
 * real e o painel de detalhe troca com fade curto. Autoplay ambiente de 6s
 * que pausa em hover/foco/aba oculta e para de vez após interação manual.
 * Semântica: `ol` + `aria-current="step"` (fluxo, não abas) + região viva.
 */
export function HowItWorksSection() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [interacted, setInteracted] = useState(false);

  const running = !reduce && !paused && tabVisible && !interacted;

  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % steps.length), AUTOPLAY_MS);
    return () => window.clearTimeout(t);
  }, [active, running]);

  const select = (index: number) => {
    setActive(index);
    setInteracted(true);
  };

  const step = steps[active];
  const StepIcon = step.icon;

  return (
    <section
      id="como-funciona"
      className="section-py relative bg-bg0"
      aria-labelledby="howitworks-title"
    >
      <div className="container-portal relative">
        <SectionHeading
          id="howitworks-title"
          title={<>Do pagamento ao trabalho em <span className="text-accent">3 passos</span></>}
          subtitle="Sem proposta demorada, sem técnico, sem complicação."
        />

        <Reveal variant="slide-up" delay={0}>
          {/* Stepper — trilho por passo, pílula deslizante no ativo */}
          <ol
            aria-label="Passos do pagamento ao trabalho"
            className="mx-auto grid max-w-3xl gap-2 md:grid-cols-3 md:gap-3"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
            }}
          >
            {steps.map((s, i) => {
              const isActive = i === active;
              const isDone = i < active;
              return (
                <li key={s.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => select(i)}
                    aria-current={isActive ? "step" : undefined}
                    aria-label={`Passo ${s.number}: ${s.title}`}
                    className={cn(
                      "relative flex min-h-[44px] w-full items-center gap-3 rounded-base px-4 py-2 text-left transition-colors duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      isActive ? "text-on-gold" : "text-text2 hover:text-text1"
                    )}
                  >
                    {isActive && (
                      reduce ? (
                        <span aria-hidden="true" className="how-pill absolute inset-0 rounded-base bg-gradient-gold" />
                      ) : (
                        <motion.span
                          aria-hidden="true"
                          layoutId="how-pill"
                          transition={{ duration: 0.32, ease: EASE }}
                          className="how-pill absolute inset-0 rounded-base bg-gradient-gold"
                        />
                      )
                    )}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "relative z-10 font-display text-caption font-extrabold tabular-nums",
                        isActive ? "text-on-gold" : "text-accent"
                      )}
                    >
                      {s.number}
                    </span>
                    <span className="relative z-10 truncate text-body font-semibold">
                      {s.short}
                    </span>
                  </button>
                  {/* Trilho do passo — preenchimento via scaleX (só transform) */}
                  <div aria-hidden="true" className="how-track mt-1 h-[2px] overflow-hidden rounded-full bg-line2">
                    {isDone ? (
                      <div className="h-full w-full rounded-full bg-gradient-gold" />
                    ) : isActive ? (
                      <motion.div
                        key={`${active}-${running ? "auto" : "manual"}`}
                        className="h-full w-full rounded-full bg-gradient-gold"
                        style={{ originX: 0 }}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={
                          running
                            ? { duration: AUTOPLAY_MS / 1000, ease: "linear" }
                            : { duration: 0.35, ease: EASE }
                        }
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Painel de detalhe — um só, troca com fade curto */}
          <div className="mx-auto mt-4 max-w-3xl md:mt-6">
            <div className="glass-card min-h-[280px] p-5 sm:p-6 lg:p-8">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step.id}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: reduce ? 0.15 : 0.3, ease: EASE }}
                >
                  <div className="mb-3 flex min-w-0 items-center gap-3 sm:gap-4">
                    <GoldIcon icon={StepIcon} size="md" variant="soft" />
                    <h3
                      id={`how-h-${step.id}`}
                      className="min-w-0 flex-1 font-display text-headline font-semibold text-text1 md:text-title-page"
                    >
                      {step.title}
                    </h3>
                    <span
                      aria-hidden="true"
                      className="shrink-0 font-mono text-caption tabular-nums text-text3"
                    >
                      {step.number} / 03
                    </span>
                  </div>
                  <p className="mb-4 text-body text-text2">{step.description}</p>
                  <ul className="grid gap-2 md:grid-cols-2" role="list">
                    {step.details.map((detail) => (
                      <li key={detail} className="flex items-center gap-2 text-body text-text2">
                        <Check className="h-4 w-4 flex-shrink-0 text-ok" aria-hidden="true" />
                        {detail}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Anúncio para leitor de tela — fora do painel animado */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {`Passo ${step.number} de 03: ${step.title}`}
          </div>
        </Reveal>

        {/* Final CTA */}
        <Reveal variant="slide-up" delay={0}>
          <div className="mt-10 text-center md:mt-16">
            <p className="mb-4 text-body text-text2">Escolha. Pague. Instale.</p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button variant="primary" size="xl" rightIcon={<ArrowRight className="h-5 w-5" />} onClick={() => scrollToSelector("#produtos")}>
                Ver planos e preços
              </Button>
              <Button variant="ghost" size="xl" onClick={() => scrollToSelector("#faq")}>
                Tirar dúvidas
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

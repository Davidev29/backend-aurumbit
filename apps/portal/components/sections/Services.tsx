"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { scrollToSelector } from "@/lib/scroll";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import {
  Blocks,
  PencilRuler,
  MessagesSquare,
  FileCheck,
  Wrench,
  GraduationCap,
  LifeBuoy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

type PathId = "adaptar" | "criar";

const paths: Array<{
  id: PathId;
  icon: typeof Blocks;
  title: string;
  description: string;
  reassurance: string;
  mailSubject: string;
}> = [
  {
    id: "adaptar",
    icon: Blocks,
    title: "Adaptar um programa pronto",
    description: "A gente parte do Base, do Pro ou do Enterprise e ajusta para o jeito da sua operação.",
    reassurance: "Parte do que já existe e ajusta para a sua operação.",
    mailSubject: "Quero adaptar um programa pronto",
  },
  {
    id: "criar",
    icon: PencilRuler,
    title: "Criar um sistema novo",
    description: "Quando nada pronto cobre, a gente cria um sistema do zero para o seu CNPJ.",
    reassurance: "Desenhado com você, para a operação da sua empresa.",
    mailSubject: "Quero um sistema novo para meu CNPJ",
  },
];

const journey = [
  {
    icon: MessagesSquare,
    title: "Conversa inicial",
    description: "A gente escuta como a sua empresa trabalha hoje, sem compromisso.",
  },
  {
    icon: FileCheck,
    title: "Proposta fechada",
    description: "Preço fechado e prazo antes de começar — você aprova primeiro.",
  },
  {
    icon: Wrench,
    title: "Construção acompanhada",
    description: "Desenvolvimento e instalação com acompanhamento, até funcionar do seu jeito.",
  },
  {
    icon: GraduationCap,
    title: "Treino da equipe",
    description: "Sua equipe aprende no dia a dia, sem depender de técnico.",
  },
  {
    icon: LifeBuoy,
    title: "Ajuda depois da entrega",
    description: "Gente de verdade, em português, quando você precisar.",
  },
];

const scope = [
  "Adaptação do programa pronto",
  "Sistema novo",
  "Instalação nos seus computadores",
  "Treino em português",
];

/**
 * Serviços sob medida — dois caminhos selecionáveis + jornada em 5 etapas.
 * Escolher o caminho atualiza o assunto do e-mail de proposta (nada se perde).
 * Copy fiel ao deck (posicionamento.md F.5): nada de prazo, preço, teste
 * grátis ou SLA inventados.
 */
export function ServicesSection() {
  const reduce = useReducedMotion();
  const [path, setPath] = useState<PathId>("adaptar");
  const selected = paths.find((p) => p.id === path) ?? paths[0];

  const mailHref =
    `mailto:contato@aurumbit.com?subject=${encodeURIComponent(selected.mailSubject)}`;

  return (
    <section
      id="servicos"
      className="section-py relative overflow-hidden bg-bg0"
      aria-labelledby="services-title"
    >
      <div className="container-portal relative">
        <SectionHeading
          id="services-title"
          title={<>Precisa de algo do seu jeito? <span className="text-accent">A gente monta para você</span></>}
          subtitle="Se o programa pronto não cobre tudo, nossa equipe adapta ou cria a solução para a sua operação — você acompanha cada etapa."
        />

        <Reveal variant="slide-up" delay={0}>
          {/* Dois caminhos — selecionável, atualiza o CTA */}
          <div
            role="group"
            aria-label="Escolha o caminho: adaptar ou criar"
            className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2 sm:gap-4"
          >
            {paths.map((p) => {
              const isActive = p.id === path;
              const PathIcon = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setPath(p.id)}
                  className={cn(
                    "glass-card group min-h-[44px] p-5 text-left transition-[border-color,background-color] duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    isActive && "border-accent"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <GoldIcon icon={PathIcon} size="md" variant="soft" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-display text-headline font-semibold text-text1">
                        {p.title}
                        {isActive && (
                          <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-gold">
                            <Check className="h-3 w-3 text-on-gold" />
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-body leading-relaxed text-text2">
                        {p.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Linha de confirmação do caminho — troca com fade curto */}
          <div className="mx-auto mt-3 max-w-4xl text-center" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={selected.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0.1 : 0.2, ease: EASE }}
                className="text-caption text-text2"
              >
                {selected.reassurance}
              </motion.p>
            </AnimatePresence>
          </div>
        </Reveal>

        {/* Jornada em 5 etapas */}
        <Reveal variant="slide-up" delay={0}>
          <div className="mx-auto mt-8 max-w-4xl md:mt-10">
            <ol className="grid gap-2 sm:gap-3 md:grid-cols-5">
              {journey.map((step, index) => {
                const StepIcon = step.icon;
                return (
                  <li
                    key={step.title}
                    className="rounded-base border border-line2 bg-bg1/60 p-4 backdrop-blur-sm"
                  >
                    <p aria-hidden="true" className="font-mono text-caption tabular-nums text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <StepIcon className="mt-2 h-5 w-5 text-accent" aria-hidden="true" />
                    <h3 className="mt-2 font-display text-body font-semibold text-text1">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-caption leading-relaxed text-text2">
                      {step.description}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        </Reveal>

        {/* Escopo + nota honesta */}
        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-2" role="list" aria-label="O que o sob medida cobre">
          {scope.map((item) => (
            <span key={item} role="listitem" className="rounded-full border border-line2 px-3 py-1.5 text-caption font-medium text-text2">
              {item}
            </span>
          ))}
        </div>
        <p className="mx-auto mt-3 max-w-4xl text-center text-caption text-text2">
          Orçamento depende do escopo — você aprova antes de começar.
        </p>

        {/* CTAs */}
        <Reveal variant="slide-up" delay={0}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row md:mt-12">
            <a
              href={mailHref}
              className="btn-primary inline-flex min-h-[52px] items-center justify-center gap-2 rounded-base px-6 py-3 text-headline font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
            >
              Pedir proposta sob medida
            </a>
            <Button variant="outline" size="lg" onClick={() => scrollToSelector("#produtos")}>
              Ver programas prontos
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

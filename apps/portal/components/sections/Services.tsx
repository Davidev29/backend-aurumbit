"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { scrollToSelector } from "@/lib/scroll";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import {
  MessagesSquare,
  FileCheck,
  Wrench,
  GraduationCap,
  LifeBuoy,
  Blocks,
} from "lucide-react";

const services = [
  {
    icon: MessagesSquare,
    title: "Conversa para entender a operação do seu CNPJ",
    description:
      "A gente escuta como a sua empresa trabalha hoje e aponta o melhor caminho — adaptar um programa pronto ou criar um novo, sem compromisso.",
  },
  {
    icon: FileCheck,
    title: "Proposta com preço fechado e prazo",
    description:
      "Você aprova antes de começar: sabe quanto vai pagar e quando fica pronto. Sem taxa escondida, sem surpresa.",
  },
  {
    icon: Wrench,
    title: "Desenvolvimento e instalação acompanhados",
    description:
      "Nossa equipe desenvolve, instala nos seus computadores e ajusta tudo com você, até funcionar do seu jeito — offline por natureza.",
  },
  {
    icon: GraduationCap,
    title: "Treino simples para a sua equipe",
    description:
      "Sua equipe aprende a usar no dia a dia, sem depender de técnico.",
  },
  {
    icon: LifeBuoy,
    title: "Ajuda em português depois da entrega",
    description:
      "Depois de pronto, você continua contando com gente de verdade para ajudar.",
  },
];

const scope = ["Integrações", "Relatórios", "Multiusuário", "Instalação local", "Regras do seu segmento"];

export function ServicesSection() {
  const scrollToProducts = () => scrollToSelector("#produtos");

  return (
    <section
      id="servicos"
      className="section-py relative overflow-hidden bg-bg0"
      aria-labelledby="services-title"
    >
      <div className="container-portal relative">
        <SectionHeading
          id="services-title"
          title="Desenvolvimento sob medida para o seu CNPJ"
          subtitle="Quando o programa pronto não basta, adaptamos ou criamos para a sua operação. Proposta com preço fechado e prazo antes de começar — você acompanha cada etapa."
        />

        {/* Faixa de escopo */}
        <div className="mx-auto mb-10 flex max-w-4xl flex-wrap items-center justify-center gap-2" role="list" aria-label="Exemplos de escopo sob medida">
          <Blocks className="h-4 w-4 text-accent" aria-hidden="true" />
          {scope.map((item) => (
            <span key={item} role="listitem" className="rounded-full border border-line2 px-3 py-1.5 text-caption font-medium text-text2">
              {item}
            </span>
          ))}
        </div>
        <p className="mx-auto -mt-6 mb-10 max-w-4xl text-center text-caption text-text2">
          Orçamento depende do escopo — você aprova antes de começar.
        </p>

        <div className="mx-auto max-w-4xl">
          <ol className="relative space-y-3 sm:space-y-4">
            {services.map((service, index) => (
              <motion.li
                key={service.title}
                className="glass-card group flex min-w-0 items-start gap-3 p-4 sm:gap-4 sm:p-5"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: false, amount: 0.3, margin: "-60px" }}
                transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
              >
                <GoldIcon
                  icon={service.icon}
                  size="md"
                  variant="soft"
                />
                <div className="min-w-0">
                  <p className="mb-1 font-mono text-caption text-accent">
                    Passo {index + 1} de {services.length}
                  </p>
                  <h3 className="mb-1 font-display text-headline font-semibold text-text1">
                    {service.title}
                  </h3>
                  <p className="text-body leading-relaxed text-text2">
                    {service.description}
                  </p>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>

        {/* CTAs */}
        <Reveal variant="slide-up" delay={0.2}>
          <div className="mt-16 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="mailto:contato@aurumbit.com?subject=Projeto%20sob%20medida%20para%20meu%20CNPJ"
              className="btn-primary inline-flex min-h-[52px] items-center justify-center gap-2 rounded-base px-6 py-3 text-headline font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
            >
              Pedir proposta sob medida
            </a>
            <Button variant="outline" size="lg" onClick={scrollToProducts}>
              Ver programas prontos
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

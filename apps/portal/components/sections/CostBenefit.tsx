"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { scrollToSelector } from "@/lib/scroll";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import {
  FileCheck,
  Ruler,
  PackageCheck,
  FileText,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const benefits = [
  {
    icon: FileCheck,
    title: "Preço fechado antes de começar",
    description:
      "Você aprova a proposta com valor e prazo por escrito antes de qualquer compromisso. O que foi combinado é o que vale.",
  },
  {
    icon: Ruler,
    title: "Pague pelo que usa",
    description:
      "Planos por tamanho da sua operação: comece pelo que precisa hoje e ajuste conforme a empresa cresce.",
  },
  {
    icon: PackageCheck,
    title: "O que já vem incluído",
    description:
      "Instalação acompanhada, treino simples para a sua equipe e ajuda em português no dia a dia.",
  },
  {
    icon: FileText,
    title: "Sem fidelidade abusiva",
    description:
      "As condições de permanência e cancelamento ficam escritas na proposta. Você decide com tudo às claras.",
  },
];

export function CostBenefitSection() {
  const scrollToProducts = () => scrollToSelector("#produtos");

  return (
    <section
      id="custo-beneficio"
      className="section-py relative overflow-hidden bg-bg1"
      aria-labelledby="cost-benefit-title"
    >
      <div className="container-portal relative">
        <SectionHeading
          id="cost-benefit-title"
          title="Bom para o bolso e claro no combinado"
          subtitle="Você sabe quanto vai pagar, o que está incluído e como pedir ajuda — antes de confirmar qualquer coisa."
        />

        <div className="mx-auto grid max-w-6xl gap-4 sm:gap-5 md:gap-6 lg:grid-cols-2">
          {benefits.map((benefit, index) => (
            <motion.article
              key={benefit.title}
              className="glass-card card-accent-top group flex min-w-0 flex-col p-5 sm:p-6 lg:p-8"
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.3, margin: "-60px" }}
              transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-5">
                <GoldIcon icon={benefit.icon} size="lg" variant="soft" />
              </div>
              <h3 className="mb-2 font-display text-headline font-bold text-text1">
                {benefit.title}
              </h3>
              <p className="text-body leading-relaxed text-text2">
                {benefit.description}
              </p>
            </motion.article>
          ))}
        </div>

        <Reveal variant="slide-up" delay={0.15}>
          <div className="glass-card mx-auto mt-6 flex max-w-6xl flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:p-6 lg:p-8">
            <GoldIcon icon={ShieldCheck} size="lg" variant="soft" />
            <div className="min-w-0 flex-1">
              <h3 className="mb-1 font-display text-headline font-bold text-text1">
                Sem surpresa na fatura
              </h3>
              <p className="text-body leading-relaxed text-text2">
                O total, as condições de pagamento e o que está incluído aparecem
                escritos antes de você confirmar. Se algo mudar no meio do caminho,
                você fica sabendo antes — e decide antes.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal variant="slide-up" delay={0.2}>
          <div className="mx-auto mt-10 flex max-w-4xl flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="mailto:contato@aurumbit.com?subject=Proposta%20para%20minha%20empresa"
              className="btn-primary inline-flex min-h-[52px] items-center justify-center gap-2 rounded-base px-6 py-3 text-headline font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
            >
              Pedir proposta
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </a>
            <Button variant="outline" size="lg" onClick={scrollToProducts}>
              Ver programas e planos
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

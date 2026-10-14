"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { scrollToSelector } from "@/lib/scroll";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import { CreditCard, KeyRound, Laptop, ArrowRight, Check } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: CreditCard,
    title: "Você escolhe o plano e paga",
    description:
      "Pix, boleto ou cartão, com o total e as condições escritos antes de confirmar. Sem taxa escondida.",
    details: [
      "Pix, boleto ou cartão",
      "Total escrito antes de confirmar",
      "Pagamento seguro",
    ],
  },
  {
    number: "02",
    icon: KeyRound,
    title: "Você recebe a chave",
    description:
      "Liberada logo após a confirmação do pagamento, junto com o passo a passo de instalação.",
    details: [
      "Chave após a confirmação do pagamento",
      "Passo a passo junto",
      "Ajuda em português se travar",
    ],
  },
  {
    number: "03",
    icon: Laptop,
    title: "Você instala e usa",
    description:
      "Nos computadores liberados pelo plano, sempre disponível — mesmo sem internet. Se travar em algo, tem gente de verdade para ajudar em português.",
    details: [
      "Funciona offline, sempre disponível",
      "Nos computadores do seu plano",
      "Ajuda em português",
    ],
  },
];

export function HowItWorksSection() {
  const scrollToProducts = () => scrollToSelector("#produtos");

  const scrollToFaq = () => scrollToSelector("#faq");

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
          subtitle="Sem proposta demorada, sem instalador complicado."
        />

        {/* Vertical timeline */}
        <div className="relative mx-auto max-w-3xl">
          {/* Gold connector line — centered on the number badges */}
          <div
            aria-hidden="true"
            className="absolute bottom-10 left-6 top-10 w-[2px] -translate-x-1/2 bg-gradient-to-b from-accent/10 via-accent/60 to-accent/10 md:left-7"
          />

          <ol className="relative space-y-4 sm:space-y-6 lg:space-y-8">
            {steps.map((step, index) => (
              <motion.li
                key={step.number}
                className="relative flex min-w-0 gap-3 sm:gap-4 lg:gap-6"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: false, amount: 0.3, margin: "-60px" }}
                transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Number badge */}
                <div
                  aria-hidden="true"
                  className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-gold font-display text-sm font-extrabold text-on-gold ring-4 ring-bg0 md:h-14 md:w-14 md:text-base"
                >
                  {step.number}
                </div>

                {/* Step card */}
                <div className="glass-card min-w-0 flex-1 p-5 sm:p-6 lg:p-8">
                  <div className="mb-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <GoldIcon icon={step.icon} size="md" variant="soft" />
                    <h3 className="min-w-0 font-display text-headline font-semibold text-text1 md:text-title-page">
                      {step.title}
                    </h3>
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
                </div>
              </motion.li>
            ))}
          </ol>
        </div>

        {/* Final CTA */}
        <Reveal variant="slide-up" delay={0.2}>
          <div className="mt-16 text-center">
            <p className="mb-4 text-body text-text2">Pague. Receba a chave. Instale.</p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button variant="primary" size="xl" rightIcon={<ArrowRight className="h-5 w-5" />} onClick={scrollToProducts}>
                Ver programas e preços
              </Button>
              <Button variant="ghost" size="xl" onClick={scrollToFaq}>
                Tirar dúvidas
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

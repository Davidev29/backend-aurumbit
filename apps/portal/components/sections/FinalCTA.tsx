"use client";

import { Reveal } from "@/components/motion";
import { scrollToSelector } from "@/lib/scroll";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import { ArrowRight, KeyRound, Wallet, LifeBuoy } from "lucide-react";

const bullets = [
  {
    icon: Wallet,
    text: "Preço claro antes de pagar.",
  },
  {
    icon: KeyRound,
    text: "Chave liberada após a confirmação do pagamento.",
  },
  {
    icon: LifeBuoy,
    text: "Ajuda em português quando precisar.",
  },
];

export function FinalCTASection() {
  const scrollToProducts = () => scrollToSelector("#produtos");

  const contactSupport = () => {
    window.location.href = "mailto:contato@aurumbit.com";
  };

  return (
    <section
      id="comecar"
      style={{ scrollMarginTop: 76 }}
      className="section-py relative overflow-hidden bg-bg1"
      aria-labelledby="final-cta-title"
    >
      <div className="container-portal relative">
        <Reveal variant="scale" delay={0}>
          {/* Centered panel with radial gold glow */}
          <div className="glass-card rounded-card relative mx-auto max-w-4xl overflow-hidden px-5 py-12 text-center sm:px-8 sm:py-14 md:px-12 md:py-20">
            {/* Radial glow */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-gold-radial opacity-30 blur-3xl" aria-hidden="true" />

            <div className="relative">
              <SectionHeading
                id="final-cta-title"
                title={<>Sua empresa <span className="text-accent">funcionando sempre</span>, começando hoje</>}
                subtitle="Escolha o plano, pague do seu jeito e receba a chave com o passo a passo. E se precisar, tem gente de verdade para ajudar em português."
                className="mb-8 lg:mb-10"
              />

              <ul className="mx-auto mb-10 flex max-w-2xl flex-col items-stretch justify-center gap-3 md:flex-row md:flex-wrap" role="list">
                {bullets.map((bullet) => (
                  <li key={bullet.text} className="flex min-w-[200px] flex-1 items-center gap-3 rounded-base border border-line1 bg-bg0/60 px-4 py-3 text-left">
                    <GoldIcon icon={bullet.icon} size="sm" variant="soft" />
                    <span className="text-body text-text1">{bullet.text}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button
                  variant="primary"
                  size="xl"
                  rightIcon={<ArrowRight className="h-5 w-5" />}
                  className="shadow-glow"
                  onClick={scrollToProducts}
                >
                  Ver programas e preços
                </Button>
                <Button
                  variant="ghost"
                  size="xl"
                  onClick={contactSupport}
                >
                  Falar com atendimento
                </Button>
              </div>

              <p className="mt-8 text-caption text-text2">
                Pagamento seguro: Pix, boleto ou cartão • Ajuda em português
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

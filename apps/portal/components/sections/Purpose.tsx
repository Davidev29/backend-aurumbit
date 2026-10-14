"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { cn } from "@/lib/utils";
import { scrollToSelector } from "@/lib/scroll";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import {
  WifiOff,
  Receipt,
  MousePointerClick,
  MessagesSquare,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const pains = [
  {
    icon: WifiOff,
    pain: "A internet caiu e o trabalho parou",
    solution:
      "O programa funciona offline por natureza — a internet só valida a licença. Quando ela volta, atualiza tudo sozinho.",
  },
  {
    icon: Receipt,
    pain: "Cada computador paga separado e a conta confunde",
    solution:
      "Cada chave já inclui os computadores do plano: 1 no Base, 3 no Pro e 50 ou mais no Enterprise.",
  },
  {
    icon: MousePointerClick,
    pain: "Instalar programa novo é complicado",
    solution:
      "Você paga, recebe a chave após a confirmação do pagamento e instala com um passo a passo simples, sem precisar de técnico.",
  },
  {
    icon: MessagesSquare,
    pain: "Ninguém responde quando você precisa",
    solution:
      "Atendimento em português, com prioridade para quem é Pro e gerente dedicado para quem é Enterprise.",
  },
  {
    icon: ShieldCheck,
    pain: "Medo de usar dado de cliente errado",
    solution:
      "Acesso só para quem você autorizar, com cuidado alinhado à lei de proteção de dados (LGPD).",
  },
];

export function PurposeSection() {
  const scrollTo = (selector: string) => scrollToSelector(selector);

  return (
    <section
      id="solucoes"
      className="section-py relative isolate overflow-hidden bg-bg0"
      aria-labelledby="purpose-title"
    >
      {/* Fundo foto + véu + vidro idênticos aos do banner (HeroLiquidBrand)
          e da vitrine (#produtos): conteúdo em z-[2]. */}
      <div className="hero-brand-photo" aria-hidden="true">
        <img src="/terceira-secao.jpg" alt="" width={720} height={404} loading="lazy" draggable={false} />
      </div>
      <div className="hero-brand-veil" aria-hidden="true" />
      <div className="hero-brand-glass" aria-hidden="true" />

      <div className="container-portal relative z-[2]">
        <SectionHeading
          id="purpose-title"
          title={<>O que trava a sua empresa hoje — e como a AurumBit resolve</>}
          subtitle="Sem trocar tudo de lugar, sem parar o atendimento, sem precisar de técnico."
        />

        <div className="relative">
          <div className="relative grid gap-4 sm:grid-cols-2 sm:gap-5 md:gap-6 lg:grid-cols-3">
            {pains.map((item, index) => (
              <motion.article
                key={item.pain}
                className={cn(
                  "glass-card group min-w-0 p-5 sm:p-6",
                  // 5 itens em grade 2/3 colunas: o órfão ocupa a linha e centraliza.
                  index === pains.length - 1 &&
                    "sm:col-span-2 sm:mx-auto sm:w-full sm:max-w-md lg:col-span-1 lg:max-w-none"
                )}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: false, amount: 0.3, margin: "-60px" }}
                transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="mb-4">
                  <GoldIcon
                    icon={item.icon}
                    size="lg"
                    variant="soft"
                  />
                </div>
                <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-text3">
                  A dor
                </p>
                <h3 className="mb-2 font-display text-headline font-semibold text-text1">
                  “{item.pain}”
                </h3>
                <p className="mb-4 text-body leading-relaxed text-text2">
                  {item.solution}
                </p>
                <div className="flex items-center gap-1 text-caption font-medium text-accent">
                  <span>Como a AurumBit resolve</span>
                  <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" aria-hidden="true" />
                </div>
              </motion.article>
            ))}
          </div>
        </div>

        {/* CTAs */}
        <Reveal variant="slide-up" delay={0.2}>
          <div className="mt-16 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="primary" size="lg" onClick={() => scrollTo("#produtos")}>
              Ver programas e preços
            </Button>
            <Button variant="outline" size="lg" onClick={() => scrollTo("#faq")}>
              Tirar dúvidas
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

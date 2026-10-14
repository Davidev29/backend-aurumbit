"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { GoldIcon, SectionHeading } from "@/components/ui";
import {
  LifeBuoy,
  Wrench,
  ClipboardCheck,
  Lock,
  Check,
  ArrowRight,
} from "lucide-react";

const commitments = [
  {
    icon: LifeBuoy,
    title: "Ajuda em português quando algo der errado",
    description:
      "Se travar no dia a dia, você fala com gente de verdade no nosso atendimento em português: contato@aurumbit.com.",
  },
  {
    icon: Wrench,
    title: "Correção do que foi entregue com defeito",
    description:
      "Se algo que entregamos não funcionar como o combinado, tratamos a correção com prioridade e mantemos você informado.",
  },
  {
    icon: ClipboardCheck,
    title: "Acompanhamento depois da entrega",
    description:
      "Após instalar ou colocar no ar, acompanhamos com você os primeiros usos e ajustamos o que for preciso dentro do combinado.",
  },
  {
    icon: Lock,
    title: "Seus dados tratados com cuidado",
    description:
      "Acesso só para quem você autorizar, registros de uso e práticas alinhadas à lei de proteção de dados (LGPD). Explicamos como tratamos seus dados, se você pedir.",
  },
];

export function AssuranceSection() {
  return (
    <section
      id="garantias"
      className="section-py relative overflow-hidden bg-bg0"
      aria-labelledby="assurance-title"
    >
      <div className="container-portal relative">
        <SectionHeading
          id="assurance-title"
          eyebrow="Confiança"
          title="Se algo der errado, você não fica sozinho"
          subtitle="Compromissos claros para os momentos em que você mais precisa de apoio — do primeiro uso ao dia a dia."
        />

        <div className="mx-auto max-w-4xl">
          <ol className="relative space-y-3 sm:space-y-4">
            {commitments.map((commitment, index) => (
              <motion.li
                key={commitment.title}
                className="glass-card group flex min-w-0 items-start gap-3 p-4 sm:gap-4 sm:p-5"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: false, amount: 0.3, margin: "-60px" }}
                transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
              >
                <GoldIcon
                  icon={commitment.icon}
                  size="md"
                  variant="soft"
                />
                <div className="min-w-0">
                  <p className="mb-1 flex items-center gap-1.5 font-mono text-caption text-accent">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Compromisso {index + 1} de {commitments.length}
                  </p>
                  <h3 className="mb-1 font-display text-headline font-semibold text-text1">
                    {commitment.title}
                  </h3>
                  <p className="text-body leading-relaxed text-text2">
                    {commitment.description}
                  </p>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>

        <Reveal variant="slide-up" delay={0.2}>
          <div className="mx-auto mt-10 max-w-4xl text-center">
            <p className="mb-6 text-body text-text2">
              Conte o que está acontecendo na sua operação — respondemos em
              português e buscamos o melhor caminho com você.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="mailto:contato@aurumbit.com?subject=Preciso%20de%20ajuda%20com%20minha%20opera%C3%A7%C3%A3o"
                className="btn-primary inline-flex min-h-[52px] items-center justify-center gap-2 rounded-base px-6 py-3 text-headline font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
              >
                Falar com atendimento
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

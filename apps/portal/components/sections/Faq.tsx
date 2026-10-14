"use client";

import { useState, type KeyboardEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, ArrowRight, LifeBuoy } from "lucide-react";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import { scrollToSelector } from "@/lib/scroll";
import { cn } from "@/lib/utils";

const SUPPORT_EMAIL = "contato@aurumbit.com";

const faqs = [
  {
    question: "Funciona sem internet mesmo?",
    answer:
      "Sim. Os programas funcionam offline por natureza — a internet só é usada para validar a licença e trazer novidades. Se a conexão cair no meio do expediente, o trabalho continua.",
  },
  {
    question: "Como instalo? Preciso de técnico?",
    answer:
      "Não. Você recebe a chave após a confirmação do pagamento e segue um passo a passo simples no próprio computador. Se travar, nosso atendimento ajuda em português.",
  },
  {
    question: "Em quantos computadores posso usar?",
    answer:
      "Depende do plano: 1 computador no Base, 3 no Pro e 50 ou mais no Enterprise. As regras para trocar de computador estão escritas no seu plano — e se precisar, nosso atendimento ajuda em português.",
  },
  {
    question: "Quais são as formas de pagamento?",
    answer:
      "Pix, boleto ou cartão, em ambiente de pagamento seguro. O total e as condições aparecem escritos antes de você confirmar, e a chave é liberada após a confirmação do pagamento.",
  },
  {
    question: "Posso cancelar quando quiser?",
    answer:
      "As condições e os prazos de cancelamento ficam escritos antes de você confirmar o pagamento. Se precisar cancelar, fale com nosso atendimento em português: contato@aurumbit.com.",
  },
  {
    question: "Meus dados e os dos meus clientes estão protegidos?",
    answer:
      "Sim, com cuidado de verdade: acesso só para quem você autorizar, registros de uso e práticas alinhadas à lei de proteção de dados (LGPD). Não prometemos “segurança absoluta” — nenhuma empresa séria promete isso — mas tratamos seus dados com responsabilidade e explicamos como, se você pedir.",
  },
  {
    question: "Roda no meu computador?",
    answer:
      "Sim, se for Windows ou macOS. Cada plano libera um número de computadores: 1 no Base, 3 no Pro e 50 ou mais no Enterprise.",
  },
  {
    question: "Se eu trocar de computador, perco a chave?",
    answer:
      "Não. As regras para trocar de computador estão escritas no seu plano — e se precisar, nosso atendimento ajuda em português.",
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const reduceMotion = useReducedMotion();

  const contactSupport = () => {
    window.location.href = `mailto:${SUPPORT_EMAIL}`;
  };

  const scrollToProducts = () => scrollToSelector("#produtos");

  // Teclado APG accordion: setas movem o foco entre as perguntas.
  const onItemKeyDown = (e: KeyboardEvent, index: number) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowDown") next = (index + 1) % faqs.length;
    if (e.key === "ArrowUp") next = (index - 1 + faqs.length) % faqs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = faqs.length - 1;
    document.getElementById(`faq-button-${next}`)?.focus();
  };

  return (
    <section
      id="faq"
      className="section-py relative bg-bg0"
      aria-labelledby="faq-title"
    >
      <div className="container-portal relative">
        <SectionHeading
          id="faq-title"
          title="Dúvidas comuns"
          subtitle="Respostas diretas, sem jargão. Se faltar algo, fale com nosso atendimento."
        />

        <div className="mx-auto max-w-3xl">
          <ul className="space-y-4" role="list">
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index;
              const buttonId = `faq-button-${index}`;
              const panelId = `faq-panel-${index}`;
              return (
                <motion.li
                  key={faq.question}
                  className={cn(
                    "glass-card overflow-hidden",
                    isOpen && "border-line3"
                  )}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: false, amount: 0.3, margin: "-40px" }}
                  transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
                >
                  <h3 className="font-display text-headline font-semibold text-text1">
                    <button
                      type="button"
                      id={buttonId}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenIndex(isOpen ? null : index)}
                      onKeyDown={(e) => onItemKeyDown(e, index)}
                      className="flex w-full items-center justify-between gap-4 p-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent md:p-7"
                    >
                      <span>{faq.question}</span>
                      <span
                        className={cn(
                          "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-line1 bg-accent-soft text-accent transition-transform duration-150",
                          isOpen && "rotate-180"
                        )}
                        aria-hidden="true"
                      >
                        <ChevronDown className="h-5 w-5" />
                      </span>
                    </button>
                  </h3>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="content"
                        id={panelId}
                        role="region"
                        aria-labelledby={buttonId}
                        initial={reduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="px-6 pb-6 text-body leading-relaxed text-text2 md:px-7 md:pb-7">
                          {faq.answer}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </ul>

          {/* Help CTA */}
          <div className="glass-card mt-8 flex min-w-0 flex-col items-center gap-5 p-5 text-center sm:p-6 md:flex-row md:p-8 md:text-left">
            <GoldIcon icon={LifeBuoy} size="md" variant="soft" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-headline font-semibold text-text1">
                Ainda com dúvida?
              </p>
              <p className="mt-1 text-body text-text2">
                Comece pelo plano ideal ou fale com gente de verdade, em português.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row">
              <Button
                variant="primary"
                rightIcon={<ArrowRight className="h-5 w-5" />}
                onClick={scrollToProducts}
              >
                Ver programas e preços
              </Button>
              <Button variant="ghost" onClick={contactSupport}>
                Falar com atendimento
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

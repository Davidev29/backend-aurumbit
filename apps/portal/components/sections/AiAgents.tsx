"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { cn } from "@/lib/utils";
import { scrollToSelector } from "@/lib/scroll";
import { Button, GoldIcon, SectionHeading } from "@/components/ui";
import {
  Database,
  BrainCircuit,
  Bot,
  ShieldCheck,
  Check,
  ArrowRight,
  Sparkles,
  FolderSync,
  MessagesSquare,
  LineChart,
} from "lucide-react";

const PIPELINE = [
  {
    icon: Database,
    step: "01 — Conectar",
    title: "Sua base",
    text: "Planilhas, arquivos e sistemas que você já usa.",
  },
  {
    icon: BrainCircuit,
    step: "02 — Treinar",
    title: "Modelo no seu setor",
    text: "Vocabulário, regras e exemplos reais da sua operação.",
  },
  {
    icon: Bot,
    step: "03 — Operar",
    title: "Agente especialista",
    text: "Responde, executa e aprende dentro do seu processo.",
  },
] as const;

const PILLARS = [
  {
    icon: Database,
    index: "01",
    tag: "integração · dados conectados",
    title: "Integramos a base que você já tem",
    description:
      "Nada de recomeçar do zero. Conectamos o agente direto aos dados que movem sua empresa — com permissão, trilha e sincronização contínua.",
    bullets: [
      "Planilhas, arquivos e sistemas que você já usa",
      "Mapeamento de dados e permissões",
      "Sincronização contínua da base",
      "Trilha de acesso alinhada à LGPD",
    ],
  },
  {
    icon: BrainCircuit,
    index: "02",
    tag: "treino · vocabulário do setor",
    title: "Treinamos no vocabulário do seu setor",
    description:
      "O modelo aprende os termos, procedimentos e exceções do seu segmento — do balcão ao backoffice — com exemplos reais da sua operação.",
    bullets: [
      "Glossário e regras do seu segmento",
      "Exemplos reais do seu atendimento",
      "Avaliação de respostas por caso",
      "Re-treino a cada ciclo de uso",
    ],
  },
  {
    icon: Bot,
    index: "03",
    tag: "atendimento · vendas · operação",
    title: "Agentes especialistas por função",
    description:
      "Um agente para cada frente: quem atende, quem vende, quem opera e quem analisa. Cada um com missão, limites e ferramentas próprias.",
    bullets: [
      "Atendimento com contexto do cliente",
      "Vendas com catálogo e propostas",
      "Operação com checklists e prazos",
      "Análise com painéis e alertas",
    ],
  },
  {
    icon: ShieldCheck,
    index: "04",
    tag: "controle · aprovação humana",
    title: "Você aprova o que é sensível",
    description:
      "IA sem controle não entra em produção. Definimos o que o agente pode fazer sozinho, o que pede aprovação e como cada resposta é auditada.",
    bullets: [
      "Permissões por papel e ferramenta",
      "Logs de cada decisão do agente",
      "Humano aprova o sensível",
      "Métricas e melhoria contínua",
    ],
  },
] as const;

const AGENT_CHIPS = [
  { icon: MessagesSquare, label: "Atendimento" },
  { icon: FolderSync, label: "Operação" },
  { icon: LineChart, label: "Análise" },
  { icon: Sparkles, label: "Vendas" },
] as const;

export function AiAgentsSection() {
  const scrollTo = (selector: string) => scrollToSelector(selector);

  return (
    <section
      id="ia-especialistas"
      className="section-py relative overflow-hidden bg-bg1"
      aria-labelledby="ai-title"
    >
      {/* fundo: glow + grade */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[700px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-gold-radial opacity-25 blur-3xl" aria-hidden="true" />
      <div className="bg-grid-gold pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_30%,black_20%,transparent_75%)]" aria-hidden="true" />

      <div className="container-portal relative">
        <SectionHeading
          id="ai-title"
          eyebrow="IA especialista no seu setor"
          title={
            <>
              Treinamos modelos e criamos{" "}
              <span className="text-accent">agentes que trabalham com a sua base</span>
            </>
          }
          subtitle="Não é um chatbot genérico: conectamos os dados da sua empresa, treinamos no vocabulário do seu segmento e colocamos um especialista digital dentro de cada etapa da operação."
        />

        {/* Pipeline: base → treino → agente */}
        <ol className="relative mx-auto mb-12 grid max-w-5xl gap-4 sm:grid-cols-2 sm:gap-5 md:mb-14 lg:grid-cols-3 lg:gap-6" role="list" aria-label="Como o agente nasce">
          <div
            aria-hidden="true"
            className="absolute left-[16%] right-[16%] top-10 hidden h-[2px] bg-gradient-to-r from-accent/10 via-accent/60 to-accent/10 lg:block"
          />
          {PIPELINE.map((p, i) => (
            <motion.li
              key={p.title}
              className={cn(
                "glass-card card-accent-top relative min-w-0 p-5 text-center sm:p-6",
                i === PIPELINE.length - 1 && "sm:col-span-2 sm:mx-auto sm:w-full sm:max-w-md lg:col-span-1 lg:max-w-none"
              )}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.3, margin: "-60px" }}
              transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mx-auto mb-4 w-fit">
                <GoldIcon icon={p.icon} size="lg" variant="soft" />
              </div>
              <p className="font-mono text-caption text-accent">{p.step}</p>
              <h3 className="mt-1 font-display text-headline font-bold text-text1">{p.title}</h3>
              <p className="mt-2 text-body leading-relaxed text-text2">{p.text}</p>
            </motion.li>
          ))}
        </ol>

        {/* 4 pilares */}
        <div className="mx-auto grid max-w-6xl gap-4 sm:gap-5 md:gap-6 lg:grid-cols-2">
          {PILLARS.map((pillar, index) => (
            <motion.article
              key={pillar.title}
              className="glass-card card-accent-top group flex min-w-0 flex-col p-5 sm:p-6 lg:p-8"
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.3, margin: "-60px" }}
              transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <GoldIcon icon={pillar.icon} size="lg" variant="soft" />
                <span className="font-display text-section font-extrabold text-line2 transition-colors group-hover:text-accent/40">
                  {pillar.index}
                </span>
              </div>
              <p className="mb-2 font-mono text-caption text-accent">{pillar.tag}</p>
              <h3 className="mb-2 font-display text-title-page font-bold text-text1">
                {pillar.title}
              </h3>
              <p className="mb-5 text-body leading-relaxed text-text2">{pillar.description}</p>
              <ul className="grid gap-2 sm:grid-cols-1" role="list">
                {pillar.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-body text-text2">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-ok" aria-hidden="true" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              {pillar.index === "03" && (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-line2 pt-5" role="list" aria-label="Exemplos de agentes">
                  {AGENT_CHIPS.map(({ icon: Icon, label }) => (
                    <span
                      key={label}
                      role="listitem"
                      className="inline-flex items-center gap-1.5 rounded-full border border-line1 bg-accent-soft px-3 py-1.5 text-caption font-semibold text-accent"
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </motion.article>
          ))}
        </div>

        {/* CTA */}
        <Reveal variant="slide-up" delay={0.15}>
          <div className="mx-auto mt-14 max-w-4xl text-center">
            <p className="mb-2 font-mono text-caption text-accent">
              Você mostra a base → treinamos no seu setor → entra em uso com você
            </p>
            <p className="mb-6 text-body text-text2">
              Conte como sua empresa opera hoje — mapeamos a base, desenhamos o
              agente e colocamos a primeira versão no ar com você.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="mailto:contato@aurumbit.com?subject=Agente%20IA%20especialista%20para%20minha%20empresa"
                className="btn-primary inline-flex min-h-[52px] items-center justify-center gap-2 rounded-base px-6 py-3 text-headline font-bold shadow-glow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-glow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
              >
                Falar sobre meu agente IA
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
              <Button variant="outline" size="lg" onClick={() => scrollTo("#servicos")}>
                Ver serviços sob medida
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

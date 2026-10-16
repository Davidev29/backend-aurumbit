"use client";

/**
 * Widget flutuante da landpage (ponte portal ↔ admin).
 * - Botão: secretária com fone (Headset) + dot online pulsante, 56px (alvo ≥44).
 * - Caixa compacta e fluida: 320×600 (estreita e alta), `glass-modal`,
 *   abre com scale-in 300ms (corte seco em reduced-motion).
 * - Fluxo vitrine: nome (1 campo) → boas-vindas animada + conversa livre.
 *   SEM triagem/sugestões aqui (a landpage é vitrine; triagem só na área
 *   logada). A primeira mensagem (boas-vindas) entra com animação de
 *   entrada; o envio é otimista (bolha na hora, reconcilia no ack).
 * - Área logada reutiliza o mesmo hook com `prefill` (dashboard/atendimento).
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Headset, Minus, SendHorizonal, ShieldCheck, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { loadName } from "@/lib/support-client";
import { useSupportChat } from "@/lib/support-client";
import {
  ChatInput,
  ChatScrollAnchor,
  MessageBubble,
  OnlineDot,
  SecretaryAvatar,
  TypingDots,
  useTypingNotifier,
} from "./SupportChat";

export function ChatWidget({ origin = "landpage" as const }: { origin?: "landpage" | "portal" }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [started, setStarted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const { user } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  const prefillName = user?.displayName || user?.name || "";
  const prefillEmail = user?.email || "";

  const chat = useSupportChat({ prefillName, prefillEmail, origin });
  const typing = useTypingNotifier(chat.sendTyping);

  useEffect(() => {
    setName(loadName() || prefillName || "");
  }, [prefillName]);

  // Hidrata sessão salva ao abrir.
  useEffect(() => {
    if (open && chat.session && !started) setStarted(true);
  }, [open, chat.session, started]);

  // Sessão descartada (morta) → volta p/ a tela de nome.
  useEffect(() => {
    if (!chat.session) setStarted(false);
  }, [chat.session]);

  // Marca leitura ao abrir / novas mensagens do agente.
  useEffect(() => {
    if (open && started) {
      const t = window.setTimeout(() => void chat.markRead(), 600);
      return () => window.clearTimeout(t);
    }
  }, [open, started, chat.messages.length]);

  // Escape fecha; foco vai p/ o painel ao abrir.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("input,button")?.focus(), 120);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open ]);

  const begin = async () => {
    const finalName = (name || prefillName || "Visitante").trim() || "Visitante";
    setBootError(null);
    try {
      // Vitrine: abre direto, sem triagem — só as boas-vindas do servidor.
      await chat.start(finalName, null, undefined, prefillEmail || undefined);
      setStarted(true);
    } catch {
      setBootError("Não consegui abrir o atendimento. Tente de novo em instantes.");
    }
  };

  return (
    <>
      {/* Botão flutuante — secretária com fone + online */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Fechar atendimento" : "Abrir atendimento — online agora"}
        initial={false}
        whileHover={reduce ? undefined : { scale: 1.05 }}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        className="fixed bottom-5 right-5 z-[45] inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-gold text-on-gold shadow-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40 md:bottom-6 md:right-6"
      >
        <Headset className="h-7 w-7" aria-hidden="true" />
        <span className="absolute -right-0.5 -top-0.5">
          <OnlineDot />
        </span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label="Atendimento AurumBit"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="glass-modal fixed bottom-24 right-4 z-[45] flex h-[600px] max-h-[82dvh] min-h-[540px] w-[calc(100vw-2rem)] max-w-[320px] flex-col overflow-hidden sm:right-6"
          >
            {/* Cabeçalho — avatar 44 centralizado verticalmente, título + status */}
            <div className="flex min-h-[72px] shrink-0 items-center gap-3 border-b border-line2 bg-bg1/60 px-5 py-3">
              <SecretaryAvatar size={44} />
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <p className="truncate text-[15px] font-semibold leading-tight text-text1">Atendimento AurumBit</p>
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption leading-tight text-text2">
                  <OnlineDot size="sm" />
                  <span className="truncate">{chat.connected ? "Online agora" : "Conectando…"}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Minimizar atendimento"
                className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-base text-text2 transition-colors duration-150 hover:bg-bg2 hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Minus className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/* Corpo */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5" role="log" aria-live="polite" aria-label="Mensagens do atendimento">
              {!started ? (
                <div className="flex flex-1 flex-col items-center justify-between gap-5 text-center">
                  {/* Boas-vindas centralizada */}
                  <div className="flex w-full flex-col items-center gap-3">
                    <SecretaryAvatar size={56} />
                    <div className="glass-card w-full rounded-card px-4 py-3">
                      <p className="text-micro font-semibold text-accent">Atendimento AurumBit</p>
                      <p className="mt-1 text-balance break-words text-body leading-relaxed">
                        Olá! Sou da equipe AurumBit. Como posso te chamar?
                      </p>
                    </div>
                    <p className="flex items-center gap-1.5 text-caption text-text2">
                      <OnlineDot size="sm" />
                      Online agora — responde em instantes
                    </p>
                  </div>
                  {/* Formulário */}
                  <form
                    className="flex w-full flex-col gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void begin();
                    }}
                  >
                    <div className="text-left">
                      <label htmlFor="chat-name" className="label">
                        Seu nome
                      </label>
                      <div className="relative">
                        <UserRound className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text3" aria-hidden="true" />
                        <input
                          id="chat-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Ex.: Maria"
                          maxLength={80}
                          autoComplete="name"
                          className="input pl-10"
                        />
                      </div>
                    </div>
                    <button type="submit" className="btn-primary inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-base px-4 text-body font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]">
                      Começar conversa
                      <SendHorizonal className="h-5 w-5 shrink-0" aria-hidden="true" />
                    </button>
                    {bootError && (
                      <p role="alert" className="error-text text-center">
                        {bootError}
                      </p>
                    )}
                  </form>
                  {/* LGPD */}
                  <p className="flex items-start justify-center gap-1.5 text-balance text-caption leading-relaxed text-text3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Ao continuar, você concorda em compartilhar nome e mensagens só para o atendimento (LGPD).</span>
                  </p>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {chat.messages.map((m, i) => (
                    <MessageBubble key={m.id} message={m} mine={m.sender === "visitor"} first={i === 0} />
                  ))}
                  {chat.typingAgent && (
                    <div className="flex justify-start">
                      <div className="glass-card rounded-card rounded-bl-sm px-3 py-2">
                        <TypingDots label="Atendente está digitando" />
                      </div>
                    </div>
                  )}
                  {/* Boas-vindas a caminho: a primeira mensagem entra com
                      animação (MessageBubble) assim que o servidor confirma. */}
                  {chat.messages.length === 0 && (
                    <div className="flex justify-start" role="status" aria-label="Preparando atendimento">
                      <div className="glass-card rounded-card rounded-bl-sm px-3 py-2">
                        <TypingDots label="Preparando atendimento" />
                      </div>
                    </div>
                  )}
                  <ChatScrollAnchor messages={chat.messages} typing={chat.typingAgent} />
                </div>
              )}
            </div>

            {/* Rodapé */}
            {started && (
              <div className="shrink-0 border-t border-line2 bg-bg1/60 px-5 py-3">
                <ChatInput
                  onSend={(t) => {
                    typing.stop();
                    void chat.send(t);
                  }}
                  onTyping={typing.notify}
                />
                <p className={cn("mt-2 text-caption", chat.connected ? "text-ok" : "text-text3")}>
                  {chat.connected ? "● Tempo real ativo" : "○ Reconectando… (suas mensagens ficam salvas)"}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

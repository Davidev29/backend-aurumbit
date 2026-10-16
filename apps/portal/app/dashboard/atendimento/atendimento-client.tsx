"use client";

/**
 * Seção de atendimento da área logada.
 * Diferença p/ a landpage: puxa nome/e-mail do cliente (`getMe`) e já abre
 * a conversa — sem pedir nome de novo. Mesmo tempo real (SSE + polling).
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Headset } from "lucide-react";
import { getMe } from "@/lib/api";
import { useSupportChat } from "@/lib/support-client";
import type { TriageSelection } from "@/lib/support-types";
import {
  ChatInput,
  ChatScrollAnchor,
  MessageBubble,
  OnlineDot,
  SecretaryAvatar,
  TriageButtons,
  TypingDots,
  useTypingNotifier,
} from "@/components/support/SupportChat";

export default function AtendimentoClient() {
  const [me, setMe] = useState<{ name: string; email: string; displayName?: string } | null>(null);
  const [triage, setTriage] = useState<TriageSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    getMe()
      .then((m) => setMe({ name: m.name, email: m.email, displayName: (m as { displayName?: string }).displayName }))
      .catch(() => setMe(null));
  }, []);

  const name = me?.displayName || me?.name || "";
  const chat = useSupportChat({ prefillName: name, prefillEmail: me?.email ?? "", origin: "portal" });
  const typing = useTypingNotifier(chat.sendTyping);
  const started = !!chat.session;

  // Auto-inicia com o nome do cliente (sem fricção).
  useEffect(() => {
    if (me && !started) {
      chat.start(name || "Cliente", null, undefined, me.email).catch(() => setError("Não consegui abrir o atendimento. Tente de novo."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  useEffect(() => {
    if (started) {
      const t = window.setTimeout(() => void chat.markRead(), 600);
      return () => window.clearTimeout(t);
    }
  }, [started, chat.messages.length]);

  const pick = async (t: TriageSelection) => {
    setTriage(t);
    await chat.send(`Quero ajuda com: ${t.label}`).catch(() => null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-title-page text-text1">Atendimento</h1>
        <p className="text-body text-text2 mt-1">
          {name ? `Olá, ${name} — fale com a gente em tempo real.` : "Fale com a gente em tempo real."}
        </p>
      </div>

      <motion.section
        aria-label="Conversa com o atendimento"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-line2 px-5 py-4">
          <SecretaryAvatar />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-text1">Atendimento AurumBit</p>
            <p className="flex items-center gap-1.5 text-caption text-text2">
              <OnlineDot size="sm" />
              {chat.connected ? "Online agora" : "Conectando…"}
            </p>
          </div>
          <span className="badge badge-gold">
            <Headset className="h-4 w-4" aria-hidden="true" />
            Tempo real
          </span>
        </div>

        <div className="flex max-h-[55dvh] min-h-[320px] flex-col gap-3 overflow-y-auto px-5 py-4" role="log" aria-live="polite" aria-label="Mensagens">
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          {!started && <p className="text-body text-text2">Abrindo sua conversa…</p>}
          {chat.messages.map((m) => (
            <MessageBubble key={m.id} message={m} mine={m.sender === "visitor"} />
          ))}
          {chat.typingAgent && (
            <div className="flex justify-start">
              <div className="glass-card rounded-card rounded-bl-sm px-3 py-2">
                <TypingDots label="Atendente está digitando" />
              </div>
            </div>
          )}
          {started && !triage && (
            <div>
              <p className="mb-2 text-caption text-text2">Escolha um assunto para agilizar:</p>
              <TriageButtons onPick={pick} />
            </div>
          )}
          <ChatScrollAnchor messages={chat.messages} typing={chat.typingAgent} />
        </div>

        <div className="border-t border-line2 px-5 py-4">
          <ChatInput
            disabled={!started}
            onSend={(t) => {
              typing.stop();
              void chat.send(t);
            }}
            onTyping={typing.notify}
          />
        </div>
      </motion.section>
    </div>
  );
}

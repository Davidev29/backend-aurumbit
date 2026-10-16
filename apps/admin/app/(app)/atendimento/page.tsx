"use client";

/**
 * Módulo administrativo do atendimento (ponte portal ↔ admin).
 * - Esquerda: fila em tempo real (nome, triagem, preview, não-lidas, online).
 * - Direita: conversa fluida (bolhas, digitação do visitante, duplo check azul).
 * - Suavidade: AnimatePresence 150–200ms, auto-scroll, reduced-motion respeitado.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, CheckCheck, Headset, Inbox, SendHorizonal } from "lucide-react";
import { useAdminSupport } from "@/lib/support-client";
import { useMe } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/lib/support-types";

function timeOf(iso: string): string {
  // À prova de "Invalid Date": ISO ausente/inválida rende "" (o chamador
  // decide o fallback) — `toLocaleTimeString` de data inválida NÃO lança.
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  try {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Ticks({ status }: { status: ChatMessage["status"] }) {
  if (status === "read") return <CheckCheck className="h-4 w-4 text-info" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck className="h-4 w-4 text-text3" aria-label="Entregue" />;
  return <Check className="h-4 w-4 text-text3" aria-label="Enviada" />;
}

type OriginFilter = "all" | "landpage" | "portal";

const ORIGIN_LABEL: Record<OriginFilter, string> = {
  all: "todas",
  landpage: "landpage",
  portal: "clientes",
};

export default function AtendimentoAdminPage() {
  const { me } = useMe();
  const reduce = useReducedMotion();
  const chat = useAdminSupport();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);

  // Separação por origem: landpage (vitrine, visitante anônimo) vs área do
  // cliente (logado, `origin !== "landpage"`). Contagens por segmento.
  const counts = useMemo(
    () => ({
      all: chat.conversations.length,
      landpage: chat.conversations.filter((c) => c.origin === "landpage").length,
      portal: chat.conversations.filter((c) => c.origin !== "landpage").length,
    }),
    [chat.conversations]
  );

  const visible = useMemo(
    () =>
      originFilter === "all"
        ? chat.conversations
        : chat.conversations.filter((c) => (originFilter === "landpage" ? c.origin === "landpage" : c.origin !== "landpage")),
    [chat.conversations, originFilter]
  );

  const active = visible.find((c) => c.id === chat.activeId) ?? null;

  // Troca de filtro com conversa ativa fora do segmento: seleciona a primeira
  // do segmento (ou limpa) para fila e detalhe andarem juntos.
  useEffect(() => {
    if (chat.activeId && !visible.some((c) => c.id === chat.activeId)) {
      chat.setActiveId(visible[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originFilter, visible]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [chat.messages.length, chat.typingVisitor, reduce]);

  useEffect(() => {
    if (chat.activeId) {
      const t = window.setTimeout(() => void chat.markRead(), 700);
      return () => window.clearTimeout(t);
    }
  }, [chat.activeId, chat.messages.length]);

  const notifyTyping = () => {
    void chat.sendTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => void chat.sendTyping(false), 1500);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !chat.activeId || sending) return;
    setSending(true);
    try {
      await chat.send(text, me?.name || "Atendimento");
      setDraft("");
      void chat.sendTyping(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-base bg-accentsoft" aria-hidden="true">
          <Headset size={22} strokeWidth={1.75} className="text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-title-page text-text1">Atendimento</h1>
          <p className="text-callout text-text2">
            Conversas da landpage e da área do cliente, em tempo real
            <span className="ml-2 inline-flex items-center gap-1.5" role="status" aria-label={chat.connected ? "Tempo real ativo" : "Reconectando"}>
              <span className={cn("inline-block h-2 w-2 rounded-full", chat.connected ? "bg-ok" : "bg-warn")} aria-hidden="true" />
              <span className="text-caption">{chat.connected ? "tempo real ativo" : "reconectando…"}</span>
            </span>
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Origem do contato">
          {(["all", "landpage", "portal"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOriginFilter(o)}
              aria-pressed={originFilter === o}
              aria-label={`Mostrar contatos: ${ORIGIN_LABEL[o]} (${counts[o]})`}
              className={cn(
                "focus-ring h-11 rounded-base border px-3 text-callout transition-colors duration-150",
                originFilter === o
                  ? "border-accent bg-accentsoft font-semibold text-text1"
                  : "border-line2 text-text2 hover:text-text1"
              )}
            >
              {ORIGIN_LABEL[o]}{" "}
              <span className="tnum text-caption" aria-hidden="true">
                ({counts[o]})
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2" role="group" aria-label="Estado da conversa">
          {(["open", "pending", "active", "closed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void chat.setStatus(s)}
              aria-pressed={active?.status === s}
              className={cn(
                "focus-ring h-11 rounded-base border px-3 text-callout capitalize transition-colors duration-150",
                active?.status === s
                  ? "border-accent bg-accentsoft font-semibold text-text1"
                  : "border-line2 text-text2 hover:text-text1"
              )}
            >
              {s === "open" ? "aberta" : s === "pending" ? "pendente" : s === "active" ? "ativa" : "fechada"}
            </button>
          ))}
        </div>
      </div>

      {chat.degraded && (
        <p role="alert" className="rounded-base border border-line2 bg-bg1 p-3 text-callout text-text2">
          Backend indisponível — exibindo fila local de demonstração. As mensagens enviadas aqui ficam só nesta sessão.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Fila */}
        <section aria-label="Fila de conversas" className="rounded-card border border-line1 bg-bg1 p-2">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <Inbox className="h-8 w-8 text-text3" aria-hidden="true" />
              <p className="text-headline text-text1">Nenhuma conversa</p>
              <p className="text-callout text-text2">
                {originFilter === "landpage"
                  ? "Nenhum contato da landpage por aqui ainda."
                  : originFilter === "portal"
                    ? "Nenhum contato de cliente logado por aqui ainda."
                    : "Novas conversas da landpage aparecem aqui na hora."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1" role="list">
              <AnimatePresence initial={false}>
                {visible.map((c) => {
                  const isActive = c.id === chat.activeId;
                  return (
                    <motion.li
                      key={c.id}
                      layout={reduce ? undefined : true}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <button
                        type="button"
                        onClick={() => chat.setActiveId(c.id)}
                        aria-current={isActive ? "true" : undefined}
                        className={cn(
                          "focus-ring relative flex w-full items-center gap-3 rounded-base px-3 py-2.5 text-left transition-colors duration-150",
                          isActive ? "bg-accentsoft" : "hover:bg-bg2"
                        )}
                      >
                        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-gold font-bold text-on-gold" aria-hidden="true">
                          {c.visitorName.trim().charAt(0).toUpperCase() || "V"}
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg1 bg-ok" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-headline text-text1">{c.visitorName}</span>
                            {c.unreadAgent > 0 && (
                              <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-micro text-accentink" aria-label={`${c.unreadAgent} não lidas`}>
                                {c.unreadAgent > 99 ? "99+" : c.unreadAgent}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-caption text-text2">
                            {c.triage ? `${c.triage.label} · ` : ""}
                            {c.origin === "landpage" ? "landpage" : "área do cliente"}
                            {timeOf(c.lastMessageAt) ? ` · ${timeOf(c.lastMessageAt)}` : ""}
                          </span>
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </section>

        {/* Conversa */}
        <section aria-label="Conversa ativa" className="flex min-h-[480px] flex-col rounded-card border border-line1 bg-bg1">
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <Headset className="h-10 w-10 text-text3" aria-hidden="true" />
              <p className="text-headline text-text1">Escolha uma conversa</p>
              <p className="text-callout text-text2">O histórico e a digitação aparecem aqui em tempo real.</p>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-line1 px-4 py-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold font-bold text-on-gold" aria-hidden="true">
                  {active.visitorName.trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-headline text-text1">{active.visitorName}</p>
                  <p className="truncate text-caption text-text2">
                    {active.visitorEmail || "sem e-mail"} · {active.triage?.label ?? "sem triagem"} ·{" "}
                    {active.origin === "landpage" ? "landpage" : "área do cliente"}
                  </p>
                </div>
                <span className="rounded-full border border-line2 px-2.5 py-1 text-micro font-semibold uppercase tracking-wider text-text2">
                  {active.status}
                </span>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-label={`Mensagens de ${active.visitorName}`}>
                {chat.messages.map((m) => {
                  const mine = m.sender === "agent";
                  return (
                    <motion.div
                      key={m.id}
                      initial={reduce ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
                    >
                      <div className={cn("max-w-[80%] rounded-card px-3 py-2 shadow-1", mine ? "rounded-br-sm bg-accent text-accentink" : "rounded-bl-sm border border-line2 bg-bg2")}>
                        {!mine && <p className="text-micro font-semibold text-accent">{m.authorName}</p>}
                        <p className="whitespace-pre-wrap break-words text-body">{m.body}</p>
                        <p className={cn("mt-1 flex items-center justify-end gap-1 text-caption", mine ? "text-accentink/80" : "text-text3")}>
                          <time dateTime={m.createdAt}>{timeOf(m.createdAt)}</time>
                          {mine && <Ticks status={m.status} />}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
                {chat.typingVisitor && (
                  <div className="flex justify-start" role="status" aria-label={`${active.visitorName} está digitando`}>
                    <div className="flex items-center gap-1.5 rounded-card rounded-bl-sm border border-line2 bg-bg2 px-3 py-2">
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-text2"
                          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} aria-hidden="true" />
              </div>

              <form
                className="flex items-end gap-2 border-t border-line1 px-4 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="admin-chat-input" className="sr-only">
                  Responder {active.visitorName}
                </label>
                <input
                  id="admin-chat-input"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    notifyTyping();
                  }}
                  placeholder={`Responder ${active.visitorName}…`}
                  maxLength={2000}
                  autoComplete="off"
                  className="focus-ring h-11 flex-1 rounded-base border border-line2 bg-bg0 px-3 text-body text-text1 placeholder:text-text3"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  aria-label="Enviar resposta"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-base bg-accent text-accentink transition-transform duration-150 active:scale-[0.97] disabled:opacity-45"
                >
                  <SendHorizonal className="h-5 w-5" aria-hidden="true" />
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

"use client";

/**
 * Núcleo visual do chat (landpage compacto + área logada expandida).
 * - Bolhas suaves (framer-motion, 150–200ms, sem layout-shift: só transform/opacity).
 * - Duplo check WhatsApp: Check (enviada) → CheckCheck cinza (entregue) → azul (lida).
 * - Digitação: 3 pontos animados (ambos os lados) + `prefers-reduced-motion` respeitado.
 * - A11y: `role=log` + `aria-live=polite`, foco visível, alvos ≥44px, sem emoji como ícone.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, CheckCheck, Headset, SendHorizonal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage, MessageStatus, TriageSelection } from "@/lib/support-types";
import { TRIAGE_OPTIONS, TRIAGE_REPLIES } from "@/lib/support-types";

export function OnlineDot({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="relative inline-flex" aria-label="Online agora" role="status">
      <span
        className={cn(
          "inline-block rounded-full bg-ok",
          size === "sm" ? "h-2 w-2" : "h-3 w-3",
          "ring-2 ring-bg1"
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full bg-ok/60 motion-safe:animate-ping",
          size === "sm" ? "h-2 w-2" : "h-3 w-3"
        )}
      />
    </span>
  );
}

export function SecretaryAvatar({ size = 40 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-gold text-on-gold"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Headset className="h-1/2 w-1/2" strokeWidth={2} />
      <span className="absolute -bottom-0.5 -right-0.5">
        <OnlineDot size="sm" />
      </span>
    </span>
  );
}

export function ReadTicks({ status }: { status: MessageStatus }) {
  if (status === "read") {
    return <CheckCheck className="h-4 w-4 text-info" aria-label="Lida" />;
  }
  if (status === "delivered") {
    return <CheckCheck className="h-4 w-4 text-text3" aria-label="Entregue" />;
  }
  return <Check className="h-4 w-4 text-text3" aria-label="Enviada" />;
}

export function TypingDots({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-text2"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

export function formatBubbleTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message, mine, first }: { message: ChatMessage; mine: boolean; first?: boolean }) {
  const reduce = useReducedMotion();
  // Horário à prova de "Invalid Date": ISO ausente/inválida rende string
  // vazia e o `<time>` nem é renderizado (só os checks).
  const time = formatBubbleTime(message.createdAt);
  // A primeira mensagem (boas-vindas) entra com destaque: sobe um pouco mais
  // e assenta com spring — as demais usam o fade/slide padrão de 180ms.
  const initial = reduce ? false : first ? { opacity: 0, y: 14, scale: 0.97 } : { opacity: 0, y: 8 };
  return (
    <motion.div
      initial={initial}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={first && !reduce ? { type: "spring", stiffness: 320, damping: 26 } : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[82%] rounded-card px-3 py-2 shadow-1",
          mine ? "bg-accent text-accentink rounded-br-sm" : "glass-card rounded-bl-sm"
        )}
      >
        {!mine && message.sender !== "visitor" && (
          <p className="text-micro font-semibold text-accent">{message.authorName}</p>
        )}
        <p className="whitespace-pre-wrap break-words text-body">{message.body}</p>
        <p className={cn("mt-1 flex items-center justify-end gap-1 text-caption", mine ? "text-accentink/80" : "text-text3")}>
          {time ? <time dateTime={message.createdAt}>{time}</time> : null}
          {mine && <ReadTicks status={message.status} />}
        </p>
      </div>
    </motion.div>
  );
}

export function TriageButtons({
  onPick,
  disabled,
}: {
  onPick: (t: TriageSelection) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Triagem inicial">
      {TRIAGE_OPTIONS.map((t) => (
        <button
          key={t.topic}
          type="button"
          disabled={disabled}
          onClick={() => onPick(t)}
          className="btn-ghost min-h-[44px] rounded-full px-4 text-callout font-medium transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export { TRIAGE_REPLIES };

export function ChatScrollAnchor({ messages, typing }: { messages: ChatMessage[]; typing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing]);
  return <div ref={ref} aria-hidden="true" />;
}

export function useTypingNotifier(sendTyping: (active: boolean) => void) {
  const timer = useRef<number | null>(null);
  const [localTyping, setLocalTyping] = useState(false);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const notify = () => {
    if (!localTyping) {
      setLocalTyping(true);
      void sendTyping(true);
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLocalTyping(false);
      void sendTyping(false);
    }, 1500);
  };
  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setLocalTyping(false);
    void sendTyping(false);
  };
  return { notify, stop };
}

export function ChatInput({
  onSend,
  onTyping,
  disabled,
  placeholder = "Escreva sua mensagem…",
}: {
  onSend: (text: string) => void;
  onTyping?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
  };
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="chat-input" className="sr-only">
        Escreva sua mensagem
      </label>
      <input
        id="chat-input"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          onTyping?.();
        }}
        placeholder={placeholder}
        maxLength={2000}
        autoComplete="off"
        className="input flex-1"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        aria-label="Enviar mensagem"
        className="btn-primary inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 disabled:opacity-45"
      >
        <SendHorizonal className="h-5 w-5" aria-hidden="true" />
      </button>
    </form>
  );
}

export function UnreadDivider() {
  return <AnimatePresence>{null}</AnimatePresence>;
}

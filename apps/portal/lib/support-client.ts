"use client";

/**
 * Cliente do chat (portal público + área logada).
 * - Sessão guest em `localStorage` (`ab_chat_session` = {id, token}).
 * - Transporte: REST + SSE (`EventSource`) com fallback de polling (2.5s)
 *   quando o stream falha. Tudo com suavidade (sem busy-loop).
 * - Área logada: `prefill` com nome/e-mail do `getMe()` (dashboard/atendimento).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatConversation, ChatEvent, ChatMessage, TriageSelection } from "@/lib/support-types";

const SESSION_KEY = "ab_chat_session";
const NAME_KEY = "ab_chat_name";

export interface ChatSession {
  id: string;
  token: string;
}

export function loadSession(): ChatSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSession;
    if (typeof parsed.id === "string" && typeof parsed.token === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveSession(s: ChatSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* noop */
  }
}

/** Códigos que significam "conversa desconhecida" (sessão morta). */
const STALE_CODES = new Set(["FORBIDDEN", "NOT_FOUND", "INVALID_TOKEN"]);

function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

export async function createConversation(input: {
  visitorName: string;
  visitorEmail?: string;
  origin: "landpage" | "portal";
  triage?: TriageSelection | null;
  customerId?: string;
  firstMessage?: string;
}): Promise<{ conversation: ChatConversation; token: string }> {
  const res = await fetch("/api/support/conversations", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create ${res.status}`);
  return json(res);
}

async function authedHeaders(session: ChatSession): Promise<Record<string, string>> {
  return { "Content-Type": "application/json", "x-chat-token": session.token };
}

export function useSupportChat(options?: { prefillName?: string; prefillEmail?: string; origin?: "landpage" | "portal" }) {
  const origin = options?.origin ?? "landpage";
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [connected, setConnected] = useState(false);
  const [typingAgent, setTypingAgent] = useState(false);
  const [sending, setSending] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Descarta a sessão guest (storage + estado) — volta p/ a tela de nome.
  const dropSession = useCallback(() => {
    clearStoredSession();
    setSession(null);
    setConversation(null);
    setMessages([]);
    setConnected(false);
  }, []);

  // Boot: sessão salva → hidrata; senão aguarda nome/triagem.
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setSession(saved);
      void hydrate(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrate = useCallback(async (s: ChatSession) => {
    try {
      const h = await authedHeaders(s);
      const [cm, mm] = await Promise.all([
        fetch(`/api/support/conversations/${encodeURIComponent(s.id)}`, { headers: h, credentials: "include" }),
        fetch(`/api/support/conversations/${encodeURIComponent(s.id)}/messages`, { headers: h, credentials: "include" }),
      ]);
      const cBody = await json<{ conversation?: ChatConversation; code?: string }>(cm);
      if (
        cm.status === 401 ||
        cm.status === 403 ||
        cm.status === 404 ||
        (typeof cBody.code === "string" && STALE_CODES.has(cBody.code))
      ) {
        // Sessão morta (conversa desconhecida — ex. restart sem persistência):
        // descarta e volta p/ a tela de nome. Sem isso o chat fica mudo.
        dropSession();
        return false;
      }
      if (cBody.conversation) setConversation(cBody.conversation);
      if (mm.ok) {
        const data = (await json<{ data: ChatMessage[] }>(mm)).data;
        if (Array.isArray(data)) {
          setMessages(data);
          setConnected(true);
        }
      }
      return true;
    } catch {
      return true; // rede falhou: mantém a sessão p/ retry (polling cobre)
    }
  }, [dropSession]);

  // SSE + polling fallback (suave: 2.5s, só quando sem stream).
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let sseOk = false;

    const openStream = () => {
      try {
        const es = new EventSource(
          `/api/support/conversations/${encodeURIComponent(session.id)}/stream?token=${encodeURIComponent(session.token)}`
        );
        esRef.current = es;
        es.onmessage = (ev) => {
          try {
            const event = JSON.parse(ev.data) as ChatEvent;
            if (event.kind === "message" && event.message) {
              sseOk = true;
              setConnected(true);
              setMessages((prev) => (prev.some((m) => m.id === event.message!.id) ? prev : [...prev, event.message!]));
            } else if (event.kind === "typing" && event.typing?.sender === "agent") {
              setTypingAgent(event.typing.active);
              if (typingTimer.current) window.clearTimeout(typingTimer.current);
              if (event.typing.active) {
                typingTimer.current = window.setTimeout(() => setTypingAgent(false), 3500);
              }
            } else if (event.kind === "read" && event.read) {
              const ids = new Set(event.read.messageIds);
              setMessages((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, status: "read" } : m)));
            }
          } catch {
            /* noop */
          }
        };
        es.onerror = () => {
          try {
            es.close();
          } catch {
            /* noop */
          }
          esRef.current = null;
        };
      } catch {
        /* fallback polling */
      }
    };

    openStream();
    pollTimer.current = window.setInterval(async () => {
      if (stopped || sseOk) return;
      await hydrate(session);
    }, 2500);

    return () => {
      stopped = true;
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      try {
        esRef.current?.close();
      } catch {
        /* noop */
      }
      esRef.current = null;
    };
  }, [session, hydrate]);

  const start = useCallback(
    async (visitorName: string, triage?: TriageSelection | null, firstMessage?: string, visitorEmail?: string) => {
      const name = (visitorName || options?.prefillName || "").trim() || "Visitante";
      const email = (visitorEmail || options?.prefillEmail || "").trim() || undefined;
      const created = await createConversation({ visitorName: name, visitorEmail: email, origin, triage: triage ?? null, firstMessage });
      const s = { id: created.conversation.id, token: created.token };
      saveSession(s);
      saveName(name);
      setSession(s);
      setConversation(created.conversation);
      await hydrate(s);
      return s;
    },
    [hydrate, options?.prefillEmail, options?.prefillName, origin]
  );

  const send = useCallback(
    async (body: string) => {
      if (!session || !body.trim() || sending) return;
      const text = body.trim();
      // Otimista: a bolha entra na hora (status `sent` = Check simples) e é
      // reconciliada com a mensagem real quando o servidor confirma — a UI
      // nunca espera o roundtrip para reagir.
      const tempId = `tmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: ChatMessage = {
        id: tempId,
        conversationId: session.id,
        sender: "visitor",
        authorName: conversation?.visitorName || "Você",
        body: text,
        status: "sent",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setSending(true);
      try {
        const h = await authedHeaders(session);
        const res = await fetch(`/api/support/conversations/${encodeURIComponent(session.id)}/messages`, {
          method: "POST",
          credentials: "include",
          headers: h,
          body: JSON.stringify({ sender: "visitor", body: text }),
        });
        if (res.ok) {
          const data = (await json<{ message: ChatMessage }>(res)).message;
          if (data) {
            setMessages((prev) =>
              prev.some((m) => m.id === data.id)
                ? prev.filter((m) => m.id !== tempId)
                : prev.map((m) => (m.id === tempId ? data : m))
            );
            return;
          }
        } else {
          const err = (await json<{ code?: string }>(res).catch(() => ({}))) as { code?: string };
          if (typeof err.code === "string" && STALE_CODES.has(err.code)) {
            // Sessão morta: descarta e volta p/ a tela de nome.
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            dropSession();
            return;
          }
        }
        // Sem confirmação: desfaz o otimismo (sem fantasma na seção).
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } finally {
        setSending(false);
      }
    },
    [session, sending, conversation?.visitorName, dropSession]
  );

  const sendTyping = useCallback(
    async (active: boolean) => {
      if (!session) return;
      try {
        const h = await authedHeaders(session);
        await fetch(`/api/support/conversations/${encodeURIComponent(session.id)}/typing`, {
          method: "POST",
          credentials: "include",
          headers: h,
          body: JSON.stringify({ sender: "visitor", active }),
        });
      } catch {
        /* transiente — ignora */
      }
    },
    [session]
  );

  const markRead = useCallback(async () => {
    if (!session) return;
    try {
      const h = await authedHeaders(session);
      await fetch(`/api/support/conversations/${encodeURIComponent(session.id)}/read`, {
        method: "POST",
        credentials: "include",
        headers: h,
        body: JSON.stringify({ by: "visitor" }),
      });
      setMessages((prev) =>
        prev.map((m) => (m.sender === "agent" || m.sender === "system" ? { ...m, status: "read" as const } : m))
      );
    } catch {
      /* noop */
    }
  }, [session]);

  return { session, conversation, messages, connected, typingAgent, sending, start, send, sendTyping, markRead, hydrate };
}

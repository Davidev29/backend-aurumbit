"use client";

/**
 * Cliente do atendimento no admin.
 * - `credentials: include` (sessão httpOnly, como `lib/api/client.ts`).
 * - Tempo real: SSE global (`/api/support/stream`) + SSE por conversa,
 *   com polling suave (3s) de fallback. Sem mock silencioso em prod:
 *   o BFF responde 502 e a UI mostra estado degradado honesto.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatConversation, ChatEvent, ChatMessage } from "@/lib/support-types";

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

export function useAdminSupport() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [archived, setArchivedList] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingVisitor, setTypingVisitor] = useState(false);
  const [connected, setConnected] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const typingTimer = useRef<number | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/support/conversations", { credentials: "include" });
      if (!res.ok) {
        setDegraded(true);
        return;
      }
      const data = await readJson<{ data: ChatConversation[] }>(res);
      if (Array.isArray(data.data)) {
        setConversations(data.data);
        setConnected(true);
        setDegraded(false);
        if (!activeId && data.data.length > 0) setActiveId(data.data[0].id);
      }
    } catch {
      setDegraded(true);
    }
  }, [activeId]);

  const loadArchived = useCallback(async () => {
    try {
      const res = await fetch("/api/support/conversations?archived=true", { credentials: "include" });
      if (!res.ok) return;
      const data = await readJson<{ data: ChatConversation[] }>(res);
      if (Array.isArray(data.data)) setArchivedList(data.data);
    } catch {
      /* gaveta abre vazia — fila ativa não é afetada */
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/support/conversations/${encodeURIComponent(id)}/messages`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await readJson<{ data: ChatMessage[] }>(res);
      if (Array.isArray(data.data)) setMessages(data.data);
    } catch {
      /* polling cobre */
    }
  }, []);

  useEffect(() => {
    void loadList();
    const t = window.setInterval(() => void loadList(), 4000);
    return () => window.clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
    else setMessages([]);
  }, [activeId, loadMessages]);

  // SSE por conversa (digitação do visitante + mensagens em tempo real).
  useEffect(() => {
    if (!activeId) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/support/conversations/${encodeURIComponent(activeId)}/stream`);
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as ChatEvent;
          if (event.kind === "message" && event.message && event.conversationId === activeId) {
            setMessages((prev) => (prev.some((m) => m.id === event.message!.id) ? prev : [...prev, event.message!]));
          } else if (event.kind === "typing" && event.typing?.sender === "visitor") {
            setTypingVisitor(event.typing.active);
            if (typingTimer.current) window.clearTimeout(typingTimer.current);
            if (event.typing.active) typingTimer.current = window.setTimeout(() => setTypingVisitor(false), 3500);
          } else if (event.kind === "read" && event.read) {
            const ids = new Set(event.read.messageIds);
            setMessages((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, status: "read" as const } : m)));
          }
        } catch {
          /* noop */
        }
      };
    } catch {
      /* polling cobre */
    }
    const poll = window.setInterval(() => void loadMessages(activeId), 3000);
    return () => {
      try {
        es?.close();
      } catch {
        /* noop */
      }
      window.clearInterval(poll);
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
    };
  }, [activeId, loadMessages]);

  const send = useCallback(
    async (body: string, authorName?: string) => {
      if (!activeId || !body.trim()) return;
      const text = body.trim();
      // Otimista: a resposta do agente entra na conversa na hora (Check
      // simples) e reconcilia com o ack do servidor — sem esperar roundtrip.
      const tempId = `tmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: ChatMessage = {
        id: tempId,
        conversationId: activeId,
        sender: "agent",
        authorName: (authorName || "Atendimento").slice(0, 80),
        body: text,
        status: "sent",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const res = await fetch(`/api/support/conversations/${encodeURIComponent(activeId)}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender: "agent", authorName: optimistic.authorName, body: text }),
        });
        if (res.ok) {
          const data = await readJson<{ message: ChatMessage }>(res);
          if (data.message) {
            setMessages((prev) =>
              prev.some((m) => m.id === data.message.id)
                ? prev.filter((m) => m.id !== tempId)
                : prev.map((m) => (m.id === tempId ? data.message : m))
            );
            return;
          }
        }
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    },
    [activeId]
  );

  const sendTyping = useCallback(
    async (active: boolean) => {
      if (!activeId) return;
      try {
        await fetch(`/api/support/conversations/${encodeURIComponent(activeId)}/typing`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender: "agent", active }),
        });
      } catch {
        /* transiente */
      }
    },
    [activeId]
  );

  const markRead = useCallback(async () => {
    if (!activeId) return;
    try {
      await fetch(`/api/support/conversations/${encodeURIComponent(activeId)}/read`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ by: "agent" }),
      });
    } catch {
      /* noop */
    }
  }, [activeId]);

  const setStatus = useCallback(
    async (status: ChatConversation["status"]) => {
      if (!activeId) return;
      await fetch(`/api/support/conversations/${encodeURIComponent(activeId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => null);
      await loadList();
    },
    [activeId, loadList]
  );

  /**
   * Arquiva/restaura (lixeira — só admin/manager na UI; backend barra por role).
   * Otimista entre as listas + reconcilia com reload das duas.
   * Retorna `false` quando o backend recusar (ex.: 403).
   */
  const setArchived = useCallback(
    async (id: string, archivedFlag: boolean): Promise<boolean> => {
      if (archivedFlag) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
      } else {
        setArchivedList((prev) => prev.filter((c) => c.id !== id));
      }
      try {
        const res = await fetch(`/api/support/conversations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: archivedFlag }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        await loadList();
        await loadArchived();
        return false;
      }
      await loadList();
      await loadArchived();
      return true;
    },
    [loadArchived, loadList]
  );

  return {
    conversations,
    archived,
    activeId,
    setActiveId,
    messages,
    typingVisitor,
    connected,
    degraded,
    send,
    sendTyping,
    markRead,
    setStatus,
    setArchived,
    reload: loadList,
    reloadArchived: loadArchived,
  };
}

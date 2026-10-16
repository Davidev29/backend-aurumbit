/**
 * Store em memória do BFF (dev/preview sem upstream).
 * Espelha `SupportService` do Nest (contrato idêntico) para o widget
 * funcionar offline-first. Em produção com `API_INTERNAL_URL`, o BFF
 * proxya para o Nest e este store não é usado.
 */
import type { ChatConversation, ChatMessage, ChatSender } from "./support-types";

interface Stored {
  conversation: ChatConversation;
  messages: ChatMessage[];
}

const store = new Map<string, Stored>();
const listeners = new Map<string, Set<(msg: ChatMessage) => void>>();
const globalListeners = new Set<(conversation: ChatConversation) => void>();

function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

function token(): string {
  const a = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return a.replace(/[^a-z0-9]/gi, "").slice(0, 32).padEnd(32, "0");
}

export function supportCreate(input: {
  visitorName: string;
  visitorEmail?: string;
  origin: "landpage" | "portal" | "admin";
  triage?: { topic: string; label: string } | null;
  customerId?: string;
  firstMessage?: string;
}): { conversation: ChatConversation; token: string } {
  const name = (input.visitorName || "Visitante").trim().slice(0, 80) || "Visitante";
  const id = uid("chat");
  const guestToken = token();
  const at = new Date().toISOString();
  const conversation: ChatConversation = {
    id,
    guestToken,
    visitorName: name,
    visitorEmail: input.visitorEmail?.slice(0, 120) || null,
    origin: input.origin,
    triage: input.triage ?? null,
    status: "open",
    assignee: null,
    customerId: input.customerId ?? null,
    lastMessageAt: at,
    unreadAgent: 0,
    unreadVisitor: 0,
    createdAt: at,
    updatedAt: at,
  };
  store.set(id, { conversation, messages: [] });
  const first = (input.firstMessage || "").trim().slice(0, 2000);
  if (first) {
    supportPost(id, { sender: "visitor", authorName: name, body: first });
  } else {
    supportPost(id, {
      sender: "system",
      authorName: "Atendimento AurumBit",
      body: `Olá, ${name}! 👋 Bem-vindo ao atendimento AurumBit. Escolha um assunto para começar — um especialista entra em instantes.`,
    });
  }
  return { conversation: { ...conversation }, token: guestToken };
}

export function supportGet(id: string): Stored | null {
  return store.get(id) ?? null;
}

export function supportCheck(id: string, t: string | null, isStaff: boolean): boolean {
  const s = store.get(id);
  if (!s) return false;
  if (isStaff) return true;
  return !!t && s.conversation.guestToken === t;
}

export function supportPost(
  id: string,
  input: { sender: ChatSender; authorName?: string; body: string }
): ChatMessage | null {
  const s = store.get(id);
  if (!s) return null;
  const body = (input.body || "").trim().slice(0, 2000);
  if (!body) return null;
  const msg: ChatMessage = {
    id: uid("msg"),
    conversationId: id,
    sender: input.sender,
    authorName:
      (input.authorName || "").slice(0, 80) ||
      (input.sender === "agent" ? "Atendimento" : input.sender === "system" ? "Atendimento AurumBit" : s.conversation.visitorName),
    body,
    status: "delivered",
    createdAt: new Date().toISOString(),
  };
  s.messages.push(msg);
  s.conversation.lastMessageAt = msg.createdAt;
  s.conversation.updatedAt = msg.createdAt;
  if (input.sender === "visitor") {
    s.conversation.unreadAgent += 1;
    if (s.conversation.status === "open") s.conversation.status = "pending";
  } else {
    s.conversation.unreadVisitor += 1;
  }
  listeners.get(id)?.forEach((fn) => {
    try {
      fn(msg);
    } catch {
      /* noop */
    }
  });
  globalListeners.forEach((fn) => {
    try {
      fn({ ...s.conversation });
    } catch {
      /* noop */
    }
  });
  return msg;
}

export function supportRead(id: string, by: ChatSender): string[] {
  const s = store.get(id);
  if (!s) return [];
  const other: ChatSender = by === "visitor" ? "agent" : "visitor";
  const affected: string[] = [];
  for (const m of s.messages) {
    const isOther = m.sender === other || (by === "visitor" && m.sender === "system");
    if (isOther && m.status !== "read") {
      m.status = "read";
      affected.push(m.id);
    }
  }
  if (by === "visitor") s.conversation.unreadVisitor = 0;
  else s.conversation.unreadAgent = 0;
  return affected;
}

export function supportList(): ChatConversation[] {
  return Array.from(store.values())
    .map((s) => ({ ...s.conversation, guestToken: "" }))
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
}

export function supportPatch(id: string, patch: { status?: ChatConversation["status"]; assignee?: string | null }) {
  const s = store.get(id);
  if (!s) return null;
  if (patch.status) s.conversation.status = patch.status;
  if (patch.assignee !== undefined) s.conversation.assignee = patch.assignee;
  s.conversation.updatedAt = new Date().toISOString();
  return { ...s.conversation };
}

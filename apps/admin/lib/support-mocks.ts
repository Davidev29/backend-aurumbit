/**
 * Mocks do atendimento (frontend-first, como `lib/mocks.ts`).
 * Usados quando `API_INTERNAL_URL` não está configurado.
 * TODO(backend pronto): remover e buscar via BFF `/api/support/*` → Nest.
 */
import type { ChatConversation, ChatMessage } from "./support-types";

const now = (deltaMs: number): string => new Date(Date.now() - deltaMs).toISOString();

export const MOCK_SUPPORT_CONVERSATIONS: ChatConversation[] = [
  {
    id: "chat-demo-1",
    guestToken: "",
    visitorName: "Maria Silva",
    visitorEmail: "maria@example.com",
    origin: "landpage",
    triage: { topic: "planos", label: "Dúvidas sobre planos" },
    status: "pending",
    assignee: null,
    customerId: null,
    lastMessageAt: now(60_000),
    unreadAgent: 1,
    unreadVisitor: 0,
    createdAt: now(12 * 60_000),
    updatedAt: now(60_000),
  },
  {
    id: "chat-demo-2",
    guestToken: "",
    visitorName: "Carlos Cliente",
    visitorEmail: "cliente@aurum.test",
    origin: "portal",
    triage: { topic: "instalacao", label: "Ajuda com instalação" },
    status: "active",
    assignee: "Ada Administradora",
    customerId: "cus-001",
    lastMessageAt: now(5 * 60_000),
    unreadAgent: 0,
    unreadVisitor: 0,
    createdAt: now(40 * 60_000),
    updatedAt: now(5 * 60_000),
  },
];

export const MOCK_SUPPORT_MESSAGES: Record<string, ChatMessage[]> = {
  "chat-demo-1": [
    {
      id: "msg-demo-1",
      conversationId: "chat-demo-1",
      sender: "system",
      authorName: "Atendimento AurumBit",
      body: "Olá, Maria Silva! 👋 Bem-vindo ao atendimento AurumBit. Escolha um assunto para começar — um especialista entra em instantes.",
      status: "read",
      createdAt: now(12 * 60_000),
    },
    {
      id: "msg-demo-2",
      conversationId: "chat-demo-1",
      sender: "visitor",
      authorName: "Maria Silva",
      body: "Quero ajuda com: Dúvidas sobre planos",
      status: "delivered",
      createdAt: now(11 * 60_000),
    },
    {
      id: "msg-demo-3",
      conversationId: "chat-demo-1",
      sender: "visitor",
      authorName: "Maria Silva",
      body: "Tenho 2 computadores na loja — qual plano cobre?",
      status: "delivered",
      createdAt: now(60_000),
    },
  ],
  "chat-demo-2": [
    {
      id: "msg-demo-4",
      conversationId: "chat-demo-2",
      sender: "visitor",
      authorName: "Carlos Cliente",
      body: "Quero ajuda com: Ajuda com instalação",
      status: "read",
      createdAt: now(40 * 60_000),
    },
    {
      id: "msg-demo-5",
      conversationId: "chat-demo-2",
      sender: "agent",
      authorName: "Ada Administradora",
      body: "Olá, Carlos! Vi sua licença Pro ativa. Onde travou a instalação — Windows ou macOS?",
      status: "read",
      createdAt: now(38 * 60_000),
    },
  ],
};

/**
 * Contrato do canal de atendimento (ponte landpage ↔ admin).
 * Espelha `apps/api/src/modules/support/support.types.ts`.
 * Forward-compatible: ignorar campos desconhecidos.
 */

export type ChatOrigin = "landpage" | "portal" | "admin";
export type ChatSender = "visitor" | "agent" | "system";
export type ChatStatus = "open" | "pending" | "active" | "closed";
export type MessageStatus = "sent" | "delivered" | "read";

export interface TriageSelection {
  topic: string;
  label: string;
}

export interface ChatConversation {
  id: string;
  guestToken: string;
  visitorName: string;
  visitorEmail?: string | null;
  origin: ChatOrigin;
  triage?: TriageSelection | null;
  status: ChatStatus;
  assignee?: string | null;
  customerId?: string | null;
  lastMessageAt: string;
  unreadAgent: number;
  unreadVisitor: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: ChatSender;
  authorName: string;
  body: string;
  status: MessageStatus;
  createdAt: string;
}

export type ChatEventKind = "message" | "typing" | "read" | "presence" | "conversation";

export interface ChatEvent {
  kind: ChatEventKind;
  conversationId: string;
  at: string;
  message?: ChatMessage;
  typing?: { sender: ChatSender; active: boolean };
  read?: { by: ChatSender; messageIds: string[] };
  presence?: { onlineAgents: number; onlineVisitors: number };
  conversation?: ChatConversation;
}

/** Triagem inicial (3 caminhos + falar com atendente). */
export const TRIAGE_OPTIONS: TriageSelection[] = [
  { topic: "planos", label: "Dúvidas sobre planos" },
  { topic: "instalacao", label: "Ajuda com instalação" },
  { topic: "pagamento", label: "Pagamento e chave" },
  { topic: "humano", label: "Falar com atendente" },
];

export const TRIAGE_REPLIES: Record<string, string> = {
  planos:
    "Ótima escolha! Temos Base (1 computador), Pro (3 computadores, atendimento mais rápido) e Enterprise (50+). Qual tamanho combina com você?",
  instalacao:
    "Vamos resolver isso juntos. Você já recebeu a chave após o pagamento? Me diga em qual computador está (Windows ou macOS) e onde travou.",
  pagamento:
    "Certo. Aceitamos Pix, boleto ou cartão em ambiente seguro. A chave libera após a confirmação. É sobre um pagamento já feito ou uma nova compra?",
  humano: "Chamando um especialista agora — ele já vê sua conversa. Enquanto isso, me diga seu nome e como posso ajudar.",
};

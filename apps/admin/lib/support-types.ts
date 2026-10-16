/**
 * Contrato do atendimento no admin (espelha Nest `support.types` + portal).
 * Forward-compatible: ignorar campos desconhecidos.
 */
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
  origin: "landpage" | "portal" | "admin";
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

export interface ChatEvent {
  kind: "message" | "typing" | "read" | "presence" | "conversation";
  conversationId: string;
  at: string;
  message?: ChatMessage;
  typing?: { sender: ChatSender; active: boolean };
  read?: { by: ChatSender; messageIds: string[] };
  conversation?: ChatConversation;
}

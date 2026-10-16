/**
 * Tipos do canal de atendimento em tempo real (ponte portal ↔ admin).
 * Contrato espelhado em `apps/portal/lib/support-types.ts` e
 * `apps/admin/lib/support-types.ts` (forward-compatible: ignorar campos novos).
 */

export type ChatOrigin = 'landpage' | 'portal' | 'admin';
export type ChatSender = 'visitor' | 'agent' | 'system';
export type ChatStatus = 'open' | 'pending' | 'active' | 'closed';
export type MessageStatus = 'sent' | 'delivered' | 'read';

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

export type ChatEventKind =
  | 'message'
  | 'typing'
  | 'read'
  | 'presence'
  | 'conversation';

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

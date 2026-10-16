-- Ponte de atendimento em tempo real (portal ↔ admin).
-- Tabelas best-effort do SupportService (memória segue valendo sem elas).
CREATE TYPE "ChatConversationStatus" AS ENUM ('OPEN', 'PENDING', 'ACTIVE', 'CLOSED');
CREATE TYPE "ChatSender" AS ENUM ('VISITOR', 'AGENT', 'SYSTEM');
CREATE TYPE "ChatMessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ');

CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "guestToken" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "visitorEmail" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'landpage',
    "triage" JSONB,
    "status" "ChatConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignee" TEXT,
    "customerId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ChatMessageStatus" NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "chat_conversations_guestToken_key" ON "chat_conversations"("guestToken");
CREATE INDEX "chat_conversations_status_idx" ON "chat_conversations"("status");
CREATE INDEX "chat_conversations_lastMessageAt_idx" ON "chat_conversations"("lastMessageAt");
CREATE INDEX "chat_messages_conversationId_createdAt_idx" ON "chat_messages"("conversationId", "createdAt");

-- Lixeira auditável do atendimento (tela de arquivados).
-- `archivedAt NULL` = na fila ativa; com valor = arquivada (mensagens intactas).
-- Best-effort no SupportService: sem esta migração, o UPDATE isolado falha
-- em silêncio e o arquivamento segue valendo só em memória.
ALTER TABLE "chat_conversations" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "chat_conversations_archivedAt_idx" ON "chat_conversations"("archivedAt");

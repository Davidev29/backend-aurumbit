-- Automação financeira: jobs idempotentes + notificações in-system.
-- Aditivo: não altera tabelas existentes (REGRA DE OURO intacta).

CREATE TABLE IF NOT EXISTS finance_automation_jobs (
  id TEXT PRIMARY KEY,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "orgId" TEXT NOT NULL,
  kind TEXT NOT NULL,
  "payableId" TEXT,
  "receivableId" TEXT,
  "barcodeMasked" TEXT,
  "scheduleDate" TIMESTAMPTZ,
  provider TEXT NOT NULL DEFAULT 'ASAAS',
  "externalId" TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  attempts INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_automation_jobs_org_payable_idx
  ON finance_automation_jobs ("orgId", "payableId");
CREATE INDEX IF NOT EXISTS finance_automation_jobs_org_receivable_idx
  ON finance_automation_jobs ("orgId", "receivableId");

CREATE TABLE IF NOT EXISTS finance_notifications (
  id TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',
  "read" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_notifications_org_created_idx
  ON finance_notifications ("orgId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS finance_notifications_org_read_idx
  ON finance_notifications ("orgId", "read");

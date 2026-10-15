-- prisma/audit/migrations/0002_fase9_security_event/migration.sql (E6, Fase 9).
-- Trilha de segurança particionada (mesmo padrão da 0001): parent
-- audit.security_events por RANGE ("createdAt"), PK ("createdAt", id).
-- Tipos (CHECK, vocabulário fechado — ver apps/api/.../audit/security-events.ts):
--   LOGIN_FAILED, MFA_FAILED, TOKEN_ROTATED, DEVICE_BLOCKED, CLONE_SUSPECT, KEY_REVEALED.
-- Append-only: o papel da app (app_audit_append) tem SÓ INSERT+SELECT;
-- UPDATE/DELETE negados no GRANT (e2e: apps/api/test/security-event.e2e.ts espera 42501).

CREATE TABLE IF NOT EXISTS audit.security_events (
    id TEXT NOT NULL,
    type TEXT NOT NULL
        CONSTRAINT security_events_type_check
        CHECK (type IN ('LOGIN_FAILED', 'MFA_FAILED', 'TOKEN_ROTATED', 'DEVICE_BLOCKED', 'CLONE_SUSPECT', 'KEY_REVEALED')),
    "actorId" TEXT,
    entity TEXT,
    "entityId" TEXT,
    metadata JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT security_events_pkey PRIMARY KEY ("createdAt", id)
) PARTITION BY RANGE ("createdAt");

CREATE TABLE IF NOT EXISTS audit.security_events_2026_10 PARTITION OF audit.security_events
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS audit.security_events_2026_11 PARTITION OF audit.security_events
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS audit.security_events_default PARTITION OF audit.security_events DEFAULT;

-- Leitura por tipo+janela (painel/observalidade); IF NOT EXISTS = idempotente
-- contra o init SQL (E2) caso o índice já exista.
CREATE INDEX IF NOT EXISTS idx_security_type_created
    ON audit.security_events (type, "createdAt");
CREATE INDEX IF NOT EXISTS idx_audit_correlation
    ON audit.audit_events (((metadata ->> 'correlationId')), "createdAt");

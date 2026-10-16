-- deploy/init-consolidated.sql — bootstrap idempotente do banco consolidado (E2/E3).
--
-- Contexto: um único database `aurumbit` com 9 schemas de domínio
-- (auth customers products access licensing billing finance audit communications).
-- Roles mínimas por domínio via PgBouncer (pool_mode transaction); o serviço
-- `migrate` usa o role `migrator` direto no Postgres (sem PgBouncer).
--
-- Execução (NÃO colocar este arquivo em docker-entrypoint-initdb.d — ele exige
-- variáveis psql `-v` de senha; quem executa é o deploy/init-dbs.sh):
--   psql -d aurumbit -f init-consolidated.sql \
--     -v migrator_password="$MIGRATOR_PASSWORD" \
--     -v app_auth_password="$APP_AUTH_PASSWORD" \
--     -v app_customers_password="$APP_CUSTOMERS_PASSWORD" \
--     -v app_products_password="$APP_PRODUCTS_PASSWORD" \
--     -v app_access_password="$APP_ACCESS_PASSWORD" \
--     -v app_licensing_password="$APP_LICENSING_PASSWORD" \
--     -v app_billing_password="$APP_BILLING_PASSWORD" \
--     -v app_communications_password="$APP_COMMUNICATIONS_PASSWORD" \
--     -v app_finance_password="$APP_FINANCE_PASSWORD" \
--     -v app_finance_reports_password="$APP_FINANCE_REPORTS_PASSWORD" \
--     -v app_audit_append_password="$APP_AUDIT_APPEND_PASSWORD" \
--     -v app_audit_read_password="$APP_AUDIT_READ_PASSWORD"
-- Senhas DEV vêm de defaults do init-dbs.sh; PROD usa hex de
-- deploy/scripts/gen-prod-env.sh (URL-safe p/ DSNs — nunca usar `@`, `/`, `+`).
--
-- Idempotência: reexecutar converge (IF NOT EXISTS / ALTER reaplicado).
-- Requer superusuário (entrypoint do Postgres) p/ CREATE ROLE / ALTER SYSTEM-scoped.

-- ---------------------------------------------------------------------------
-- 1. Schemas de domínio
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS customers;
CREATE SCHEMA IF NOT EXISTS products;
CREATE SCHEMA IF NOT EXISTS access;
CREATE SCHEMA IF NOT EXISTS licensing;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS communications;

-- ---------------------------------------------------------------------------
-- 2. Hardening de defaults (PG15+ já remove CREATE do PUBLIC; reafirmar)
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE aurumbit FROM PUBLIC;

-- Teto anti-transação-órfã no nível do banco (roles críticas podem apertar mais).
ALTER DATABASE aurumbit SET idle_in_transaction_session_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 3. Roles (criação idempotente; senha/limite convergem no §4 via ALTER)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator WITH LOGIN CONNECTION LIMIT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth WITH LOGIN CONNECTION LIMIT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_customers') THEN
    CREATE ROLE app_customers WITH LOGIN CONNECTION LIMIT 15;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_products') THEN
    CREATE ROLE app_products WITH LOGIN CONNECTION LIMIT 15;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_access') THEN
    CREATE ROLE app_access WITH LOGIN CONNECTION LIMIT 20;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_licensing') THEN
    CREATE ROLE app_licensing WITH LOGIN CONNECTION LIMIT 20;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_billing') THEN
    CREATE ROLE app_billing WITH LOGIN CONNECTION LIMIT 15;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_communications') THEN
    CREATE ROLE app_communications WITH LOGIN CONNECTION LIMIT 15;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_finance') THEN
    CREATE ROLE app_finance WITH LOGIN CONNECTION LIMIT 20;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_finance_reports') THEN
    CREATE ROLE app_finance_reports WITH LOGIN CONNECTION LIMIT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_audit_append') THEN
    CREATE ROLE app_audit_append WITH LOGIN CONNECTION LIMIT 20;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_audit_read') THEN
    CREATE ROLE app_audit_read WITH LOGIN CONNECTION LIMIT 5;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Senhas (via -v psql; `:'var'` = literal escapado) + reconvergência de limite
-- ---------------------------------------------------------------------------
ALTER ROLE migrator WITH LOGIN CONNECTION LIMIT 5 PASSWORD :'migrator_password';
ALTER ROLE app_auth WITH LOGIN CONNECTION LIMIT 30 PASSWORD :'app_auth_password';
ALTER ROLE app_customers WITH LOGIN CONNECTION LIMIT 15 PASSWORD :'app_customers_password';
ALTER ROLE app_products WITH LOGIN CONNECTION LIMIT 15 PASSWORD :'app_products_password';
ALTER ROLE app_access WITH LOGIN CONNECTION LIMIT 20 PASSWORD :'app_access_password';
ALTER ROLE app_licensing WITH LOGIN CONNECTION LIMIT 20 PASSWORD :'app_licensing_password';
ALTER ROLE app_billing WITH LOGIN CONNECTION LIMIT 15 PASSWORD :'app_billing_password';
ALTER ROLE app_communications WITH LOGIN CONNECTION LIMIT 15 PASSWORD :'app_communications_password';
ALTER ROLE app_finance WITH LOGIN CONNECTION LIMIT 20 PASSWORD :'app_finance_password';
ALTER ROLE app_finance_reports WITH LOGIN CONNECTION LIMIT 5 PASSWORD :'app_finance_reports_password';
ALTER ROLE app_audit_append WITH LOGIN CONNECTION LIMIT 20 PASSWORD :'app_audit_append_password';
ALTER ROLE app_audit_read WITH LOGIN CONNECTION LIMIT 5 PASSWORD :'app_audit_read_password';

-- ---------------------------------------------------------------------------
-- 5. CONNECT no banco
-- ---------------------------------------------------------------------------
GRANT CONNECT ON DATABASE aurumbit TO migrator;
-- DDL do migrator: todo baseline Prisma começa com
-- `CREATE SCHEMA IF NOT EXISTS "public"` — sem CREATE no banco, o
-- `migrate deploy` morre com `permission denied for database` (só CONNECT não basta).
-- Mínimo necessário: só o migrator ganha CREATE; app_* seguem sem.
GRANT CREATE ON DATABASE aurumbit TO migrator;
GRANT CONNECT ON DATABASE aurumbit TO app_auth, app_customers, app_products;
GRANT CONNECT ON DATABASE aurumbit TO app_access, app_licensing;
GRANT CONNECT ON DATABASE aurumbit TO app_billing, app_communications;
GRANT CONNECT ON DATABASE aurumbit TO app_finance, app_finance_reports;
GRANT CONNECT ON DATABASE aurumbit TO app_audit_append, app_audit_read;

-- ---------------------------------------------------------------------------
-- 6. Tabelas append-only de auditoria, particionadas POR RANGE ("createdAt")
-- Coluna "createdAt" camelCase = mesma da migration 0001 do domínio audit.
-- PK inclui a chave de partição (exigência do particionamento declarativo).
-- FONTE ÚNICA COMPARTILHADA com prisma/audit/migrations/0001_baseline e 0002:
-- mesma forma, tudo IF NOT EXISTS — a ordem init→migrate ou migrate→init
-- converge (migrate deploy não difere DDL, só registra _prisma_migrations).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.audit_events (
  id TEXT NOT NULL,
  "actorId" TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  "entityId" TEXT,
  metadata JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_pkey PRIMARY KEY ("createdAt", id)
) PARTITION BY RANGE ("createdAt");

-- Mesma forma de prisma/audit/migrations/0002 (type + CHECK fechado 6 tipos).
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

-- Partições mensais 2026_09..2027_01 + default (idempotentes).
CREATE TABLE IF NOT EXISTS audit.audit_events_2026_09
  PARTITION OF audit.audit_events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS audit.audit_events_2026_10
  PARTITION OF audit.audit_events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS audit.audit_events_2026_11
  PARTITION OF audit.audit_events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS audit.audit_events_2026_12
  PARTITION OF audit.audit_events FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS audit.audit_events_2027_01
  PARTITION OF audit.audit_events FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE IF NOT EXISTS audit.audit_events_default
  PARTITION OF audit.audit_events DEFAULT;

CREATE TABLE IF NOT EXISTS audit.security_events_2026_09
  PARTITION OF audit.security_events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS audit.security_events_2026_10
  PARTITION OF audit.security_events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS audit.security_events_2026_11
  PARTITION OF audit.security_events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS audit.security_events_2026_12
  PARTITION OF audit.security_events FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS audit.security_events_2027_01
  PARTITION OF audit.security_events FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE IF NOT EXISTS audit.security_events_default
  PARTITION OF audit.security_events DEFAULT;

-- Índices (propagam p/ as partições; IF NOT EXISTS = reexecução segura).
CREATE INDEX IF NOT EXISTS idx_audit_events_created_id
  ON audit.audit_events ("createdAt", id);
CREATE INDEX IF NOT EXISTS idx_audit_correlation
  ON audit.audit_events (((metadata ->> 'correlationId')), "createdAt");
CREATE INDEX IF NOT EXISTS idx_security_events_created_id
  ON audit.security_events ("createdAt", id);
CREATE INDEX IF NOT EXISTS idx_security_correlation
  ON audit.security_events (((metadata ->> 'correlationId')), "createdAt");

-- Dono das tabelas de auditoria = migrator (não o superusuário do init).
-- Sem isso, `migrate deploy` do domínio audit falha com
-- `must be owner of table security_events` ao criar índices/partições
-- (CREATE INDEX exige ownership). Bloco idempotente.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'audit' LOOP
    EXECUTE format('ALTER TABLE audit.%I OWNER TO migrator', r.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7. USAGE por schema (migrator opera DDL em todos; app só no seu domínio)
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA auth, customers, products TO migrator;
GRANT USAGE, CREATE ON SCHEMA access, licensing, billing TO migrator;
GRANT USAGE, CREATE ON SCHEMA finance, audit, communications TO migrator;

GRANT USAGE ON SCHEMA auth TO app_auth;
GRANT USAGE ON SCHEMA customers TO app_customers;
GRANT USAGE ON SCHEMA products TO app_products;
GRANT USAGE ON SCHEMA access TO app_access;
GRANT USAGE ON SCHEMA licensing TO app_licensing;
GRANT USAGE ON SCHEMA billing TO app_billing;
GRANT USAGE ON SCHEMA communications TO app_communications;
GRANT USAGE ON SCHEMA finance TO app_finance, app_finance_reports;
GRANT USAGE ON SCHEMA audit TO app_audit_append, app_audit_read;

-- ---------------------------------------------------------------------------
-- 8. DML em tabelas/sequências existentes
-- Regra: domínio = full; finance_reports/audit_read = só SELECT;
-- audit_append = SELECT,INSERT (append-only: sem UPDATE/DELETE).
-- REVOKE ALL prévio nos leitores p/ convergir mesmo se full foi dado antes.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA customers TO app_customers;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA products TO app_products;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA access TO app_access;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA licensing TO app_licensing;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO app_billing;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA communications TO app_communications;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finance TO app_finance;
GRANT ALL ON ALL TABLES IN SCHEMA auth, customers, products TO migrator;
GRANT ALL ON ALL TABLES IN SCHEMA access, licensing, billing TO migrator;
GRANT ALL ON ALL TABLES IN SCHEMA finance, audit, communications TO migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM app_finance_reports;
GRANT SELECT ON ALL TABLES IN SCHEMA finance TO app_finance_reports;

REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM app_audit_append, app_audit_read;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO app_audit_append;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO app_audit_read;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth TO app_auth;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA customers TO app_customers;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA products TO app_products;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA access TO app_access;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA licensing TO app_licensing;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA billing TO app_billing;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA communications TO app_communications;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA finance TO app_finance, app_finance_reports;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO app_audit_append, app_audit_read;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth, customers, products TO migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA access, licensing, billing TO migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA finance, audit, communications TO migrator;

-- ---------------------------------------------------------------------------
-- 9. Privilégios default p/ objetos FUTUROS criados pelo migrator (migrations)
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_auth;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA auth
  GRANT USAGE, SELECT ON SEQUENCES TO app_auth;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA customers
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_customers;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA customers
  GRANT USAGE, SELECT ON SEQUENCES TO app_customers;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA products
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_products;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA products
  GRANT USAGE, SELECT ON SEQUENCES TO app_products;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA access
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_access;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA access
  GRANT USAGE, SELECT ON SEQUENCES TO app_access;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA licensing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_licensing;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA licensing
  GRANT USAGE, SELECT ON SEQUENCES TO app_licensing;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA billing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_billing;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA billing
  GRANT USAGE, SELECT ON SEQUENCES TO app_billing;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA communications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_communications;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA communications
  GRANT USAGE, SELECT ON SEQUENCES TO app_communications;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA finance
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_finance;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA finance
  GRANT USAGE, SELECT ON SEQUENCES TO app_finance;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA finance
  GRANT SELECT ON TABLES TO app_finance_reports;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA finance
  GRANT USAGE, SELECT ON SEQUENCES TO app_finance_reports;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA audit
  GRANT SELECT, INSERT ON TABLES TO app_audit_append;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA audit
  GRANT USAGE, SELECT ON SEQUENCES TO app_audit_append;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA audit
  GRANT SELECT ON TABLES TO app_audit_read;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA audit
  GRANT USAGE, SELECT ON SEQUENCES TO app_audit_read;

-- ---------------------------------------------------------------------------
-- 10. search_path por role (defesa em profundidade; Prisma fixa ?schema= anyway)
-- ---------------------------------------------------------------------------
ALTER ROLE migrator IN DATABASE aurumbit SET search_path
  = auth, customers, products, access, licensing, billing, finance, audit, communications, public;
ALTER ROLE app_auth IN DATABASE aurumbit SET search_path = auth;
ALTER ROLE app_customers IN DATABASE aurumbit SET search_path = customers;
ALTER ROLE app_products IN DATABASE aurumbit SET search_path = products;
ALTER ROLE app_access IN DATABASE aurumbit SET search_path = access;
ALTER ROLE app_licensing IN DATABASE aurumbit SET search_path = licensing;
ALTER ROLE app_billing IN DATABASE aurumbit SET search_path = billing;
ALTER ROLE app_communications IN DATABASE aurumbit SET search_path = communications;
ALTER ROLE app_finance IN DATABASE aurumbit SET search_path = finance;
ALTER ROLE app_finance_reports IN DATABASE aurumbit SET search_path = finance;
ALTER ROLE app_audit_append IN DATABASE aurumbit SET search_path = audit;
ALTER ROLE app_audit_read IN DATABASE aurumbit SET search_path = audit;

-- ---------------------------------------------------------------------------
-- 11. Timeouts por role (statement; lock onde o domínio é quente em contenção)
-- ---------------------------------------------------------------------------
-- migrator sem statement_timeout (DDL/dump longo, fora do PgBouncer).
ALTER ROLE migrator IN DATABASE aurumbit SET statement_timeout = '0';
ALTER ROLE app_auth IN DATABASE aurumbit SET statement_timeout = '5s';
ALTER ROLE app_customers IN DATABASE aurumbit SET statement_timeout = '5s';
ALTER ROLE app_products IN DATABASE aurumbit SET statement_timeout = '5s';
ALTER ROLE app_access IN DATABASE aurumbit SET statement_timeout = '5s';
ALTER ROLE app_licensing IN DATABASE aurumbit SET statement_timeout = '5s';
ALTER ROLE app_billing IN DATABASE aurumbit SET statement_timeout = '10s';
ALTER ROLE app_communications IN DATABASE aurumbit SET statement_timeout = '10s';
ALTER ROLE app_finance IN DATABASE aurumbit SET statement_timeout = '60s';
ALTER ROLE app_finance_reports IN DATABASE aurumbit SET statement_timeout = '60s';
ALTER ROLE app_audit_append IN DATABASE aurumbit SET statement_timeout = '30s';
ALTER ROLE app_audit_read IN DATABASE aurumbit SET statement_timeout = '30s';

ALTER ROLE app_auth IN DATABASE aurumbit SET lock_timeout = '2s';
ALTER ROLE app_access IN DATABASE aurumbit SET lock_timeout = '1s';
ALTER ROLE app_licensing IN DATABASE aurumbit SET lock_timeout = '2s';

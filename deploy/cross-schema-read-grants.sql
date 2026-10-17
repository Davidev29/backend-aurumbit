-- deploy/cross-schema-read-grants.sql — concessões de LEITURA cross-schema
-- pontuais (Fase 6+, funil de clientes).
--
-- O isolamento por domínio é deliberado (ADR-006 §6): cada app_* só enxerga o
-- próprio schema. Mas existe precedente oficial de leitura cruzada — o
-- `app_finance_reports` lê `finance` com SELECT apenas, sem DML.
--
-- O funil de clientes precisa materializar `customers.customer_profiles` a
-- partir de `auth.user_identities` (o cadastro nasce no domínio auth). O
-- mínimo possível:
--
--   app_customers → SELECT em auth.user_identities
--
 -- Sem DML, sem acesso a `auth.credentials`, `auth.auth_sessions` ou tokens.
-- A FK cross-schema `customer_profiles.identity_id → auth.user_identities(id)`
-- já existe
 -- (migração prisma/customers/0002_fase9_identity_fk) — esta concessão é o que
-- falta para o domínio customers ler a origem do funil.
--
-- Idempotente. Executar como `migrator` (ou superuser) — o dono das tabelas.

-- Leitura mínima: a tabela que contém o cadastro. NADA mais do schema auth.
GRANT USAGE ON SCHEMA auth TO app_customers;
GRANT SELECT ON TABLE auth.user_identities TO app_customers;

-- Garante também para tabelas futuras deste nome (DEFAULT PRIVILEGES do
-- migrator — mesma convenção de init-consolidated.sql:267-275).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA auth '
         || 'GRANT SELECT ON TABLES TO app_customers';
  END IF;
END
$$;
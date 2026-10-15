-- deploy/grant-repair.sql — reaplica DML pós-migrate (Fase 9, ADR-006).
-- migrate deploy cria tabelas como `migrator`; este arquivo garante as roles
-- de app mesmo quando DEFAULT PRIVILEGES ainda não cobriam a tabela.
-- Idempotente. Executado por deploy/scripts/migrate-all.sh (MIGRATOR_DATABASE_URL).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA customers TO app_customers;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA products TO app_products;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA access TO app_access;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA licensing TO app_licensing;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO app_billing;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finance TO app_finance;
GRANT SELECT ON ALL TABLES IN SCHEMA finance TO app_finance_reports;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO app_audit_append;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO app_audit_read;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA communications TO app_communications;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA auth TO app_auth;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA customers TO app_customers;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA products TO app_products;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA access TO app_access;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA licensing TO app_licensing;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA billing TO app_billing;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA finance TO app_finance;

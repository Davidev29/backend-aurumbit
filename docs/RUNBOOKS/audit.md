# Runbook — Auditoria append-only (Fase 9, E6)

Fonte normativa: `PROJECT.md` §§2/4, `docs/LGPD.md` (§1, linha Audit — 5 anos),
`prisma/audit/migrations/0001_baseline` + `0002_fase9_security_event`,
helper `apps/api/src/modules/audit/security-events.ts`.

Tabelas (banco `audit`, schema `audit`, particionadas por `RANGE ("createdAt")`):

| Tabela | Conteúdo | PK real (DDL) |
|---|---|---|
| `audit.audit_events` | trilha de negócio (`license.reveal`, `finance.*`, `dlq.*`…) | `("createdAt", id)` |
| `audit.security_events` | trilha de segurança (6 tipos CHECK: `LOGIN_FAILED`, `MFA_FAILED`, `TOKEN_ROTATED`, `DEVICE_BLOCKED`, `CLONE_SUSPECT`, `KEY_REVEALED`) | `("createdAt", id)` |

Regra de ouro: **append-only — a aplicação NUNCA faz UPDATE/DELETE.**
O papel da app (`app_audit_append`) tem **só `INSERT` + `SELECT`**; qualquer
`UPDATE`/`DELETE` falha com `42501 insufficient_privilege` (coberto pelo e2e
`apps/api/test/security-event.e2e.ts`).

## 1. Leitura — SEMPRE na parent

O Postgres faz pruning automático das partições mensais. Nunca selecione
partição nominal (`audit_events_2026_10`) direto, salvo export/detach.

```sql
-- Janela por mês (usa pruning):
SELECT id, "actorId", action, entity, "entityId", "createdAt"
  FROM audit.audit_events
 WHERE "createdAt" >= '2026-10-01' AND "createdAt" < '2026-11-01'
 ORDER BY "createdAt", id LIMIT 100;

-- Segurança por tipo+janela (índice idx_security_type_created):
SELECT type, "actorId", entity, "entityId", "createdAt"
  FROM audit.security_events
 WHERE type = 'LOGIN_FAILED'
   AND "createdAt" >= now() - interval '7 days'
 ORDER BY "createdAt" DESC LIMIT 100;

-- Correlação ponta-a-ponta (índice idx_audit_correlation):
SELECT action, entity, "createdAt"
  FROM audit.audit_events
 WHERE metadata ->> 'correlationId' = '<correlationId>';

-- Partições existentes (auditoria de cobertura):
SELECT tablename FROM pg_tables
 WHERE schemaname = 'audit' AND tablename LIKE 'audit\_events\_%'
 ORDER BY 1;
```

Conexão (`psql`): `psql "$DATABASE_URL_AUDIT"` — se a URL usa `?schema=public`,
qualifique com `audit.` (como nos exemplos) ou ajuste o search_path da role:

```sql
ALTER ROLE app_audit_append IN DATABASE audit SET search_path = audit, public;
```

## 2. Criar a partição do mês seguinte

Automático via `deploy/scripts/audit-partition.sh` (idempotente —
`CREATE TABLE IF NOT EXISTS ... PARTITION OF ...`), cron mensal:

```
0 3 1 * *  /opt/aurum/deploy/scripts/audit-partition.sh >> /var/log/aurum/audit-partition.log 2>&1
```

Manual (mesmo efeito do script):

```sql
CREATE TABLE IF NOT EXISTS audit.audit_events_2027_02 PARTITION OF audit.audit_events
    FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE IF NOT EXISTS audit.security_events_2027_02 PARTITION OF audit.security_events
    FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
```

A partição `*_default` absorve qualquer escrita fora das janelas mensais
(fail-safe — nunca rejeita escrita por falta de partição). Se a default
acumular linhas, crie o mês correspondente e mova-as (a default esvazia
sozinha após o `FOR VALUES` passar a cobrir o intervalo — linhas novas já
caem na partição certa).

## 3. Retenção 5 anos — DETACH (nunca DELETE)

`audit_events`/`security_events` **NUNCA entram nos jobs de retenção/purge**
(`retention.service.ts` não os referencia — lifecycle exclusivo por partição):

1. Após 5 anos, `DETACH` a partição fria (operação O(1), sem reescrita):
   ```sql
   ALTER TABLE audit.audit_events DETACH PARTITION audit.audit_events_2026_09;
   ```
2. **Export WORM antes de qualquer DROP** (evidência fiscal/legal):
   ```bash
   pg_dump -t 'audit.audit_events_2026_09' audit > /worm/audit/audit_events_2026_09.sql
   sha256sum /worm/audit/audit_events_2026_09.sql > /worm/audit/audit_events_2026_09.sha256
   ```
3. Só então, se a política vigente permitir: `DROP TABLE audit.audit_events_2026_09;`
4. Mesmo procedimento para `audit.security_events_*`.

Proibido: `DELETE FROM audit.*`, `TRUNCATE`, `UPDATE` em trilha (quebra a
garantia append-only e invalida a cadeia de custódia).

## 4. Incidentes comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| Escrita falha `no partition of relation` | sem partição do mês e sem default | rodar `audit-partition.sh`; verificar `*_default` existe |
| `42501` em leitura da app | papel sem `SELECT` ou search_path sem `audit` | revisar GRANTs + `ALTER ROLE ... SET search_path` (§1) |
| `42501` em escrita do teste negativo | **esperado** (papel append-only) | sem ação — é a garantia funcionando |
| Default crescendo | mês sem partição criada (cron falhou) | criar o mês (§2) + checar log do cron |
| `migrate deploy` do audit falha em PK | tabela legada não-particionada (pré-E6) | só em banco vazio: baseline E6 recria particionado; banco com dados exige migração assistida (fora deste runbook) |

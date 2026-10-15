#!/usr/bin/env bash
# deploy/scripts/seed-prod.sh — Fase 7 T3. Seed REAL idempotente (admin + catálogo mínimo).
#
# O que faz (nesta ordem, tudo UPSERT — re-executável, nunca duplica):
#   1. auth.user_identities: admin demo (status ACTIVE, e-mail verificado).
#   2. auth.credentials: senha do admin (hash scrypt PHC, mesmo formato do
#      apps/api crypto.ts; gerado via node:crypto, sem dependências).
#   3. access.access_grants: role ADMIN global p/ o admin.
#   4. customers.customer_profiles: perfil PF do admin.
#   5. products.products + product_plans + features + plan_features: catálogo
#      mínimo (Base/Pro/Enterprise, MONTH/YEAR em centavos).
#
# TROCA DE SENHA OBRIGATÓRIA: o schema não tem campo mustChangePassword
# (mudança de schema fora do escopo Fase 7) — a obrigação é PROCEDURAL:
# o script imprime o lembrete + docs/RUNBOOKS/deploy.md Gate 5 exige a troca
# no primeiro login. Sem isso, o aceite T3 não fecha.
#
# Env: PGHOST/PGPORT/POSTGRES_USER/POSTGRES_PASSWORD (mesma convenção do
# backup-check.sh), SEED_ADMIN_EMAIL (default admin@aurumbit.local),
# SEED_ADMIN_PASSWORD (OBRIGATÓRIA — fail-closed sem ela; nunca logada).
# Saída: 0 = ok; 1 = falha (qualquer passo aborta, set -euo pipefail).
# NUNCA: logar senha/hash; FK cross-DB; commitar .env.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"

# DB único (9 schemas de domínio). MIGRATOR/seed usam a mesma base; o schema
# vai qualificado em cada statement (nada de search_path implícito).
SINGLE_DB="${SINGLE_DB:-aurumbit}"

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@aurumbit.local}"
ADMIN_NORM="$(printf '%s' "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

: "${SEED_ADMIN_PASSWORD:?SEED_ADMIN_PASSWORD env obrigatória (senha inicial do admin; será exigida a troca no 1º login)}"

log() { echo "[seed-prod] $*"; }
die() { echo "[seed-prod] FATAL: $*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || die "psql ausente no host"
command -v node >/dev/null 2>&1 || die "node ausente no host (gera o hash scrypt)"

# Hash scrypt PHC idêntico ao apps/api crypto.ts
# ($scrypt$N$r$p$saltB64$hashB64, N=16384 r=8 p=1 keylen=32). A senha via env,
# nunca via argv/arquivo; o hash resultante nunca é impresso em log.
make_hash() {
  SEED_PW="$SEED_ADMIN_PASSWORD" node -e "
const { scryptSync, randomBytes } = require('node:crypto');
const pw = process.env.SEED_PW ?? '';
if (!pw || pw.length < 8) { console.error('senha <8 chars'); process.exit(1); }
const salt = randomBytes(16);
const dk = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
console.log('\$scrypt\$16384\$8\$1\$' + salt.toString('base64') + '\$' + dk.toString('base64'));
"
}

# Fail-closed de schema: confere que as colunas esperadas existem antes de
# inserir; se o Prisma divergir (camelCase vs snake), falha LISTANDO o real
# em vez de inserir na coluna errada.
assert_columns() { # $1=schema $2=table $3=colunas esperadas (espaço-separadas)
  local schema="$1" table="$2" expected="$3" actual missing
  actual="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SINGLE_DB" -tAc \
    "SELECT column_name FROM information_schema.columns WHERE table_schema='$schema' AND table_name='$table' ORDER BY 1;" | tr '\n' ' ')"
  missing=""
  for c in $expected; do
    case " $actual " in *" $c "*) ;; *) missing="$missing $c";; esac
  done
  if [ -n "$missing" ]; then
    die "schema divergente: $schema.$table sem coluna(s):$missing | reais: [$actual]"
  fi
}

q() { # q <schema-ignorado> <sql...> — psql fail-closed (ON_ERROR_STOP) sem pager, sempre no DB único
  local _schema="$1"; shift
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SINGLE_DB" -v ON_ERROR_STOP=1 -q -tAc "$*"
}

qfile() { # qfile <schema-ignorado> — lê SQL do stdin (heredoc), falha alto em erro, sempre no DB único
  local _schema="$1"
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SINGLE_DB" -v ON_ERROR_STOP=1 -q -tA
}

log "start admin=$ADMIN_EMAIL pg=$PGHOST:$PGPORT"

# --- 0. Pré-voo: pg + 9 schemas + colunas âncora ------------------------------
COUNT_SCHEMAS="$(q postgres "SELECT count(*) FROM information_schema.schemata WHERE schema_name IN ('auth','customers','products','access','licensing','billing','finance','audit','communications');")"
[ "$COUNT_SCHEMAS" = "9" ] \
  || die "schemas ausentes em $SINGLE_DB (encontrados: $COUNT_SCHEMAS/9; rode migrate-all.sh antes)"
assert_columns auth user_identities "id email_norm email_display status email_verified_at failed_attempts mfa_enabled createdAt updatedAt"
assert_columns auth credentials "id identity_id password_hash createdAt updatedAt"
assert_columns access access_grants "id subjectId orgId role reason createdAt"
assert_columns customers customer_profiles "id kind identity_id organization_id status name email created_at updated_at"
assert_columns products products "id code name slug description status machines_allowed createdAt updatedAt"
assert_columns products product_plans "id productId code name priceCents billingInterval validFrom validTo status supersededBy createdAt updatedAt"
assert_columns products features "id code name description kind unit channel createdAt"
assert_columns products plan_features "planId featureId value createdAt"
log "pré-voo ok (9 schemas + colunas âncora conferem)"

# --- 1+2. Admin: identidade + credencial --------------------------------------
IDENTITY_ID="$(q auth "INSERT INTO auth.user_identities (id, email_norm, email_display, status, email_verified_at, failed_attempts, mfa_enabled, \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid(), '$ADMIN_NORM', '$ADMIN_EMAIL', 'ACTIVE', now(), 0, false, now(), now()) ON CONFLICT (email_norm) DO UPDATE SET email_display=EXCLUDED.email_display, status='ACTIVE', email_verified_at=COALESCE(auth.user_identities.email_verified_at, now()), \"updatedAt\"=now() RETURNING id;")"
[ -n "$IDENTITY_ID" ] || die "upsert user_identities não retornou id"
log "identidade admin ok (id=${IDENTITY_ID:0:8}…)"

PHASH="$(make_hash)" || die "falha ao gerar hash da senha"
[ -n "$PHASH" ] || die "hash vazio"
q auth "INSERT INTO auth.credentials (id, identity_id, password_hash, \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid(), '$IDENTITY_ID', '$PHASH', now(), now()) ON CONFLICT (identity_id) DO UPDATE SET password_hash=EXCLUDED.password_hash, \"updatedAt\"=now();"
unset PHASH
log "credencial admin ok (re-run reseta a senha p/ SEED_ADMIN_PASSWORD — documentado)"

# --- 3. Grant ADMIN global ------------------------------------------------------
q access "INSERT INTO access.access_grants (id, \"subjectId\", \"orgId\", role, reason, \"createdAt\") VALUES (gen_random_uuid(), '$IDENTITY_ID', 'global', 'ADMIN', 'seed-prod initial admin', now()) ON CONFLICT (\"subjectId\", \"orgId\", role) DO NOTHING;"
log "grant ADMIN ok"

# --- 4. Perfil PF do admin ------------------------------------------------------
q customers "INSERT INTO customers.customer_profiles (id, kind, identity_id, organization_id, status, name, email, created_at, updated_at) VALUES (gen_random_uuid(), 'PF', '$IDENTITY_ID', NULL, 'ACTIVE', 'Administrador', '$ADMIN_EMAIL', now(), now()) ON CONFLICT (identity_id) DO UPDATE SET status='ACTIVE', updated_at=now();"
log "perfil PF ok"

# --- 5. Catálogo mínimo (upserts por chave natural; preço em centavos) ----------
qfile products <<'SQL'
INSERT INTO products.products (id, code, name, slug, description, status, machines_allowed, "createdAt", "updatedAt") VALUES
 (gen_random_uuid(), 'aurum-base', 'Aurum Base', 'aurum-base', 'O essencial para quem tem 1 computador.', 'ACTIVE', 1, now(), now()),
 (gen_random_uuid(), 'aurum-pro', 'Aurum Pro', 'aurum-pro', 'O completo para até 3 computadores.', 'ACTIVE', 3, now(), now()),
 (gen_random_uuid(), 'aurum-enterprise', 'Aurum Enterprise', 'aurum-enterprise', 'Para operações grandes, com controle e gerente dedicado.', 'ACTIVE', 50, now(), now())
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, status='ACTIVE', machines_allowed=EXCLUDED.machines_allowed, "updatedAt"=now();

INSERT INTO products.features (id, code, name, description, kind, unit, channel, "createdAt") VALUES
 (gen_random_uuid(), 'OFFLINE_ACCESS', 'Funciona offline', 'Opera sem internet; só valida a licença.', 'BOOLEAN', NULL, 'BOTH', now()),
 (gen_random_uuid(), 'SEATS', 'Computadores por chave', 'Máquinas simultâneas por licença.', 'QUOTA', 'seats', 'BOTH', now()),
 (gen_random_uuid(), 'PRIORITY_SUPPORT', 'Atendimento prioritário', 'Suporte em português com prioridade.', 'BOOLEAN', NULL, 'BOTH', now()),
 (gen_random_uuid(), 'DEDICATED_MANAGER', 'Gerente dedicado', 'Acompanhamento dedicado (Enterprise).', 'BOOLEAN', NULL, 'BOTH', now()),
 (gen_random_uuid(), 'WEB_ACCESS', 'Acesso web', 'Terminal web da assinatura (SaaS).', 'BOOLEAN', NULL, 'WEB', now()),
 (gen_random_uuid(), 'DESKTOP_APP', 'App desktop', 'Programa instalado, licença perpétua.', 'BOOLEAN', NULL, 'DESKTOP', now())
ON CONFLICT (code) DO UPDATE SET channel=EXCLUDED.channel;
SQL
log "produtos + features ok"

qfile products <<'SQL'
-- Planos: (code, validFrom) é a chave natural; preço IMUTÁVEL por linha.
-- Re-run com o mesmo validFrom não cria linha nova (catálogo imutável, §products).
WITH p AS (
  SELECT id, code FROM products.products WHERE code IN ('aurum-base','aurum-pro','aurum-enterprise')
)
INSERT INTO products.product_plans (id, "productId", code, name, "priceCents", "billingInterval", "validFrom", "validTo", status, "supersededBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p.id, v.code, v.name, v.price, v.interval, '2026-09-01T12:00:00Z'::timestamptz, NULL, 'ACTIVE', NULL, now(), now()
FROM p JOIN (VALUES
  ('aurum-base', 'AURUM_BASE_YEAR', 'Aurum Base Anual', 119900, 'YEAR'),
  ('aurum-base', 'AURUM_BASE_ONETIME', 'Aurum Base Vitalício', 349900, 'ONE_TIME'),
  ('aurum-pro', 'AURUM_PRO_MONTH', 'Aurum Pro Mensal', 14990, 'MONTH'),
  ('aurum-pro', 'AURUM_PRO_YEAR', 'Aurum Pro Anual', 119900, 'YEAR'),
  ('aurum-enterprise', 'AURUM_ENT_YEAR', 'Aurum Enterprise Anual', 499900, 'YEAR')
) AS v(pcode, code, name, price, interval) ON (p.code = v.pcode)
ON CONFLICT (code, "validFrom") DO UPDATE SET status='ACTIVE', "updatedAt"=now();

-- Vínculos plano↔feature (PK planId+featureId; re-run = DO NOTHING).
WITH pl AS (SELECT id, code FROM products.product_plans WHERE status='ACTIVE'),
     f AS (SELECT id, code FROM products.features)
INSERT INTO products.plan_features ("planId", "featureId", value, "createdAt")
SELECT pl.id, f.id, v.val, now()
FROM (VALUES
  ('AURUM_BASE_YEAR','OFFLINE_ACCESS','true'), ('AURUM_BASE_YEAR','SEATS','1'), ('AURUM_BASE_YEAR','WEB_ACCESS','true'),
  ('AURUM_BASE_ONETIME','OFFLINE_ACCESS','true'), ('AURUM_BASE_ONETIME','SEATS','1'), ('AURUM_BASE_ONETIME','DESKTOP_APP','true'),
  ('AURUM_PRO_MONTH','OFFLINE_ACCESS','true'), ('AURUM_PRO_MONTH','SEATS','3'), ('AURUM_PRO_MONTH','PRIORITY_SUPPORT','true'), ('AURUM_PRO_MONTH','WEB_ACCESS','true'),
  ('AURUM_PRO_YEAR','OFFLINE_ACCESS','true'), ('AURUM_PRO_YEAR','SEATS','3'), ('AURUM_PRO_YEAR','PRIORITY_SUPPORT','true'), ('AURUM_PRO_YEAR','WEB_ACCESS','true'),
  ('AURUM_ENT_YEAR','OFFLINE_ACCESS','true'), ('AURUM_ENT_YEAR','SEATS','50'),
  ('AURUM_ENT_YEAR','PRIORITY_SUPPORT','true'), ('AURUM_ENT_YEAR','DEDICATED_MANAGER','true'), ('AURUM_ENT_YEAR','WEB_ACCESS','true')
) AS v(pcode, fcode, val)
JOIN pl ON pl.code = v.pcode JOIN f ON f.code = v.fcode
ON CONFLICT ("planId", "featureId") DO NOTHING;
SQL
log "planos + vínculos ok"

# --- 6. Contagens âncora (evidência do aceite T3) -------------------------------
log "contagens:"
q auth "SELECT 'auth.user_identities=' || count(*) FROM auth.user_identities;"
q access "SELECT 'access.access_grants=' || count(*) FROM access.access_grants;"
q customers "SELECT 'customers.customer_profiles=' || count(*) FROM customers.customer_profiles;"
q products "SELECT 'products.products=' || count(*) FROM products.products;"
q products "SELECT 'products.product_plans=' || count(*) FROM products.product_plans WHERE status='ACTIVE';"
q licensing "SELECT 'licensing.licenses=' || count(*) FROM licensing.licenses;"
q billing "SELECT 'billing.invoices=' || count(*) FROM billing.invoices;"
q finance "SELECT 'finance.ledger_entries=' || count(*) FROM finance.ledger_entries;"
q audit "SELECT 'audit.audit_events=' || count(*) FROM audit.audit_events;"
q communications "SELECT 'communications.email_templates=' || count(*) FROM communications.email_templates;"

echo ""
echo "[seed-prod] done (admin + catálogo, idempotente)."
echo "[seed-prod] OBRIGATÓRIO: trocar a senha do admin ($ADMIN_EMAIL) no 1º login (aceite T3)."

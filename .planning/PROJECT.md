# Aurum Bit — PROJECT.md (rev. 2026-10-10)

## Visão
Ecossistema Aurum Bit: produtos Windows/Mac + terminal web + app, backend plataforma e terminal administrativo Next.js.

## Decisões vinculantes
- **Monólito modular NestJS** (`apps/api` + `apps/workers`), extração só com gatilho concreto.
- **Banco único `aurumbit`, 9 schemas** (auth, customers, products, access, licensing, billing, finance, audit, communications). Fronteira por schema + módulo + outbox. Default sem FK cross-schema; **exceção única:** `customers.identity_id → auth.user_identities` (`RESTRICT`); intra-schema `RESTRICT` (ver `docs/ADR-006-consolidacao-single-db.md`).
- **Outbox PG + BullMQ/Redis**. Worker publica, consumidores idempotentes, retry + DLQ. Redis nunca é fonte definitiva.
- **Titular: ambos** — PF global + Organização PJ opcional via Membership (OWNER/ADMIN/FINANCE/MEMBER).
- **Vigência licença:** inicia na **confirmação do pagamento**.
- **Tolerância:** 3 dias degradado, depois suspende. Ver § Offline.
- **Manager financeiro:** sem acesso implícito. `finance.read` é concessão explícita, escopada por organização, auditada, default deny. `finance.manage` só admin. Preserva decisão anterior de leitura liberada apenas como elegível, não automática.
- **Asaas:** Sandbox-first, adaptador NestJS, segredos gerenciados. MCP só docs.
- **Resend:** eventos, templates versionados, idempotência por eventId.
- **Admin:** Next.js App Router, menu por permissões backend.

## §1 Offline vs validade vs graça (normativo)
- `expires_at` = `starts_at + 1M/12M` calendário UTC. `grace_until = expires_at + 3d`.
- `off_exp = min(token_iat + 7d, expires_at + 7d)`. Ou seja: teto de 7d sem contato com servidor, nunca estende validade além de +7d da expiração.
- Validação offline no app:
  - `now <= lic_exp` e `now <= off_exp` → ALLOW
  - `lic_exp < now <= grace_until` e `now <= off_exp` → ALLOW degradado (`degraded:true`, banner, sem ações destrutivas)
  - `now > grace_until` → DENY `EXPIRED`, mesmo se `now <= off_exp`
  - `now > off_exp` → DENY `OFFLINE_EXPIRED`, exige online
- `grace_until` e `off_exp` vão no payload JWT. Renovação em grace mantém continuidade (`starts_at = max(now, expires_at_anterior)`).

## §2 Chaves de licença (armazenamento e revelação)
- Formato: `AURUM-XXXX-XXXX-XXXX`, gerado CSPRNG 128-bit.
- DB `licensing.licenses`: nunca plaintext. Guarda `key_hash = SHA256(key)` UNIQUE, `key_prefix` (4 chars) + `key_last4` p/ suporte, `key_enc` (AES-256-GCM/KMS) só p/ reemissão auditada.
- API/UI: `keyMasked` (`AURUM-••••-••••-AB12`) por padrão. Logs nunca têm chave.
- Revelação: `POST /v1/licenses/:id/reveal` exige `license.read` + MFA se admin, rate-limit 10/h, retorna plaintext uma vez, gera `AuditEvent license.reveal` com ator/motivo. Sem endpoint bulk.
- Revogação: bump `token_version`, invalida JWTs e offline-tokens no próximo online.

## §3 finance.read escopado
- `manager`: default deny financeiro. Concessão exige `admin` + `organization_id` + motivo, registrada em Audit + Membership/RoleGrant.
- Frontend oculta `/financeiro` sem `finance.read`; backend nega 403. Export segue mesma regra.
- `user`: nunca `finance.*`, nunca `bonus.grant`/`license.adjust`.

## §4 IP, device_hash, geolocalização (finalidade e retenção)
- **IP:** finalidade segurança/antifraude + auditoria. Armazena só `ip_hash = HMAC(ip, salt rotativo 90d)` + `/24` mascarado p/ detecção. Raw só em memória no request. Retenção: hash 90d, depois purge. Base LGPD: legítimo interesse + obrigação legal. Sem geolocalização precisa.
- **device_hash:** finalidade enforcement limite máquinas + detecção clone. `HMAC(secret_rotativo, license_id || app_instance_id)`, nunca hardware cru (MAC/IMEI). Retenção: vida da licença + 12 meses, depois anonimiza. Revogação remove vínculo, mantém hash p/ trilha.
- **Geolocalização:** não coletamos GPS. Geo por IP é aproximada, usada só em memória p/ sinal `cloned_suspect` (ex. logins impossíveis), nunca persistida como localização do usuário. UI exibe só cidade aproximada quando já disponível no evento de risco, com aviso de imprecisão.
- Consentimento/Retenção documentados em LGPD.md; `gdpr/erase` apaga raw, mantém hashes p/ obrigação legal até prazo.

## §5 Idempotência, fora de ordem, reconciliação Asaas
- Chaves: `Idempotency-Key` em POSTs, `UNIQUE(provider,externalId)` em Payment/Refund/WebhookReceipt, `UNIQUE(eventId)` em ProcessedEvent/Outbox, `jobId=eventId` no BullMQ, `idempotencyKey=eventId` no Resend.
- Webhook: `RECEIVED → VALIDATED → APPLIED/REJECTED/DUPLICATE`. `ON CONFLICT(provider,externalId) DO NOTHING` → 200 duplicate. `assertTransition(from,to)`; ilegal → REJECTED + alerta, sem sobrescrever.
- Fora de ordem: consumidor checa `version/occurredAt` e estado atual antes de aplicar; evento antigo nunca regride estado terminal (CONFIRMED/REFUNDED). `PaymentConfirmed` exige `paidAt + amount` casando.
- Reconciliação: hourly (pendentes <7d) + daily 03:00 America/Sao_Paulo (30d). Pagina Asaas, compara `externalId→status`, cria evento sintético `RECONCILIATION` (`recon:<id>:<data>`) pelo mesmo pipeline. Divergência valor/estado → alerta + e-mail admin. Métricas `billing.recon.*`.

## §6 Templates e-mail (escopo real)
- **Fora de escopo:** `deposit-confirmed`, `withdrawal-confirm`, `order-filled` (resíduo wallet/crypto do draft, não pertencem ao Aurum Bit).
- **Escopo real v1:** `verify-email`, `reset-password`, `new-device-login`, `account-blocked`, `mfa-code`, `organization-invite`, `payment-confirmed`, `payment-failed`, `payment-overdue`, `subscription-cancelled`, `license-issued`, `license-expiring`, `license-renewed`, `bonus-granted`.
- Todos versionados (`template+template_version`), link opaco TTL curto, sem PII sensível no corpo.

## Stack / Domínios / Monorepo
Mantidos da rev. anterior. Prisma 1 schema por domínio, sem FK cross. API `/v1`, eventos `*.v1`.

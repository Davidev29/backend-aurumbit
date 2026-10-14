# Aurum Bit — REQUIREMENTS.md (rev. 2026-10-10)

## 1. Auth + Customers
- [ ] Registro, verify/resend sem enumeração, login lockout, sessão familyId
- [ ] Refresh rotativo + reuse → revoga família
- [ ] Forgot/reset 60min hash-only, revoga sessões
- [ ] MFA obrigatório admin/OWNER
- [ ] Organizations + Membership, último OWNER protegido
- [ ] Consents versionados; GDPR export/anonymize
- [ ] IP: só `ip_hash` HMAC salt 90d, raw em memória; retenção 90d — ver PROJECT §4

## 2. Products + Access + Licensing
- [ ] Catálogo imutável (nova linha p/ preço), Contract congela preço
- [ ] Entitlement fonte verdade, priority bonus5/contract10/subscription20/license30
- [ ] check-access p99 <50ms, batch 50, degradado em grace
- [ ] License: `starts_at=PaymentConfirmed`, `expires_at` calendário, `grace_until=+3d`, `off_exp=min(iat+7d, expires+7d)` — validação §1 PROJECT
- [ ] Chave: `key_hash` UNIQUE, `prefix/last4`, `key_enc` KMS; API só `keyMasked`; reveal auditado + MFA + rate-limit — ver PROJECT §2
- [ ] Device: `device_hash` HMAC, limite backend FOR UPDATE, rotate 15min, clone suspect; retenção licença+12m
- [ ] Bonus motivo >=10, vitalícia `ends_at null` revogável
- [ ] Cron evaluator 5min determinístico

## 3. Billing + Finance (Asaas)
- [ ] Customer espelho, Subscription/Invoice/Payment/Refund com máquinas de estado + `assertTransition`
- [ ] Idempotência: `UNIQUE(provider,externalId)`, `Idempotency-Key`, `jobId=eventId` — ver PROJECT §5
- [ ] Webhook RECEIVED>VALIDATED>APPLIED, ack <2s, duplicate 200
- [ ] Fora de ordem: nunca regride terminal; checa version/occurredAt
- [ ] Reconciliação hourly + daily 03:00 America/Sao_Paulo, evento `RECONCILIATION`, alerta divergência
- [ ] Finance previsto/pendente/realizado, Transaction único mutador saldo, ProjectionSnapshot hash
- [ ] RBAC: `finance.read` explícito escopado por org (default deny manager), `finance.manage` só admin — ver PROJECT §3

## 4. Communications + Audit + Workers
- [ ] Outbox por domínio + Relay SKIP LOCKED + purge 30d
- [ ] Filas BullMQ + DLQ + replay; `idempotencyKey=eventId` Resend
- [ ] Templates escopo real (14): verify, reset, new-device, blocked, mfa-code, org-invite, payment-confirmed/failed/overdue, subscription-cancelled, license-issued/expiring/renewed, bonus-granted. `deposit/withdrawal/order-filled` FORA — ver PROJECT §6
- [ ] Audit append-only particionado, SecurityEvent, sem UPDATE/DELETE
- [ ] CorrelationId propagado; Heartbeat 60s / window 5min; offline=sem atividade
- [ ] Retenção: outbox 30d, email vars 90d, audit 5a, sessão exp+30d, ip_hash 90d, device_hash licença+12m, logs 30d. Sem GPS; geo-IP só memória

## 5. Admin Next.js
- [ ] Shell colapsável persistida, Drawer mobile, CmdK, OrgSwitcher, TimezoneBadge
- [ ] BFF httpOnly, `/financeiro` exige `finance.read` explícito, senão 403
- [ ] Licença sempre mascarada, reveal auditado; heartbeat dot + lastActivity; ajuste/bônus justificativa >=10
- [ ] Cursor pagination, Skeleton/Error/Empty/Stale, pt-BR, TZ America/Sao_Paulo, WCAG AA

## 6. Plataforma / NFRs
- [ ] Clone→up→migrate→seed→ready <10min (aceite Fase 1)
- [ ] Prisma multi-DB, migrações backward-compatible, CI/CD, /v1 versionado
- [ ] Segurança base + LGPD; observabilidade base

# Runbook — Auth (login / refresh / reuse / MFA)

Fluxos implementados na cadeia `common/guards` (ordem e códigos em
`docs/ADR-002-guards.md`). Detalhe de negócio (lockout, família,
TOTP) vive no domínio `modules/auth`; aqui, o comportamento de borda.

## 1. Login

1. `POST /v1/auth/login` (`@Public()`, rate-limit `login` 5/min IP+e-mail).
2. Credencial válida + e-mail verificado → emite access JWT 15min
   (`sub`/`sid`/`jti`/`iss`/`aud`, `amr:["pwd"]`) + refresh (família nova).
3. Conta com MFA (admin/OWNER obrigatório — REQUIREMENTS §1) → access
   com `amr:["pwd"]` e `ticket` step-up; rotas `@RequireMfa()` respondem
   403 `MFA_REQUIRED` até `POST /v1/auth/mfa/verify` retornar claims
   `amr:["pwd","mfa"]`.

## 2. Refresh rotativo + reuse

1. `POST /v1/auth/refresh` (`@Public()`, refresh no corpo ou cookie httpOnly).
2. Refresh válido e não usado → **rotaciona**: emite par novo, invalida o
   antigo (mesma família).
3. **Reuse** (refresh já usado) → sinal de roubo: **revoga a família
   inteira** (`SessionGuard` passa a responder 401 `SESSION_REVOKED`
   p/ todos os access da família) + `AuditEvent` + e-mail `new-device-login`.
4. Access expirado (`exp`) → 401 `TOKEN_EXPIRED`; cliente usa o refresh.

## 3. Verificação / recuperação

- Registro → `verify-email` (link opaco TTL curto). Sem `email_verified`,
  rotas autenticadas respondem 403 `EMAIL_NOT_VERIFIED` (exceção:
  `@AllowUnverified()`, ex. reenvio).
- `forgot/reset`: token 60min hash-only, **revoga sessões** ao concluir
  (REQUIREMENTS §1) — access antigos caem em 401 `SESSION_REVOKED`.

## 4. Tabela de falhas (borda)

| Sintoma | Causa provável | Ação |
|---|---|---|
| 401 `UNAUTHORIZED` sem corpo útil | Sem `Authorization: Bearer` | Enviar access válido |
| 401 `TOKEN_EXPIRED` | `exp` passou | `POST /v1/auth/refresh` |
| 401 `TOKEN_REJECTED` | `iss`/`aud` divergentes | Conferir `JWT_ISS`/`JWT_AUD` do emissor |
| 401 `SESSION_*` após refresh reuse | Família revogada (roubo?) | Re-login + investigar `AuditEvent` |
| 403 `MFA_REQUIRED` | Step-up pendente | `POST /v1/auth/mfa/verify` |
| 403 `EMAIL_NOT_VERIFIED` | Conta não verificada | Reenviar `verify-email` |
| 400 `ORG_REQUIRED` / 403 `ORG_FORBIDDEN` | `X-Org-Id` ausente ou sem membership ACTIVE | Conferir header + convite/membership |

## 5. Exemplo (smoke)

```bash
# login (público)
curl -s -X POST localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"..."}'

# rota autenticada
curl -s localhost:3000/v1/customers/me \
  -H "Authorization: Bearer $ACCESS"

# rota escopada por org
curl -s localhost:3000/v1/customers/me \
  -H "Authorization: Bearer $ACCESS" -H 'X-Org-Id: org_123'
```

## 6. GDPR — portabilidade e eliminação (Fase 6)

Ordem canônica (sem FK cross-DB; a vigência vive em `customers`):

1. `POST /v1/customers/gdpr/anonymize` — pode negar **409** `ACTIVE com
   vigência em curso` (cancele/não-renove antes de anonimizar).
2. `POST /v1/auth/gdpr/anonymize` — revoga sessões/famílias, limpa
   credencial+MFA, apaga e-mail (`anon_<id>@anonymized.local`), marca
   `DELETED`, emite `auth.identity.anonymized.v1` (só `identityId`).
   Inexistente/já apagado → 404.

```bash
# export (JSON portável; e-mail mascarado, sem hashes/segredos)
curl -s localhost:3000/v1/auth/gdpr/export \
  -H "Authorization: Bearer $ACCESS"
curl -s localhost:3000/v1/customers/gdpr/export \
  -H "Authorization: Bearer $ACCESS"   # stub atual: x-identity-id até ligar JWT

# eliminação (customers primeiro!)
curl -s -X POST localhost:3000/v1/customers/gdpr/anonymize \
  -H "Authorization: Bearer $ACCESS"
curl -s -X POST localhost:3000/v1/auth/gdpr/anonymize \
  -H "Authorization: Bearer $ACCESS"
```

Pós-eliminação: login cai em 401 genérico (anti-enumeração); hashes
(`ip_hash`, `device_hash`, `key_hash`) permanecem até os prazos de
`docs/LGPD.md` (obrigação legal, art. 16). Auditoria nunca é apagada
(append-only, §5 de `docs/SECURITY.md`).

# Runbook — Licenciamento (Fase 3)

Fonte normativa: `PROJECT.md` §§1–2/4–5, `docs/LGPD.md`, `docs/ADR-003-offline.md`.

## 1. Ciclo de vida

| Operação | Endpoint | Guarda | Efeito |
|---|---|---|---|
| Emitir | `POST /v1/licenses` | `x-role: admin` | Chave `AURUM-XXXX-XXXX-XXXX` (CSPRNG 128-bit) em plaintext **1x**; resto mascarado (`keyMasked`). Outbox `LicenseIssued`. Audit `license.issue` (só `keyMasked`+`months`). |
| Renovar | `POST /v1/licenses/:id/renew` | `x-role: admin` | Em grace: `starts_at = max(now, expires_at anterior)` (sem lacuna). Outbox `LicenseRenewed`. Audit `license.renew`. |
| Suspender | `POST /v1/licenses/:id/suspend` | `x-role: admin` | Status `suspended`; check nega. Retomar via `/resume`. |
| Revogar | `POST /v1/licenses/:id/revoke` | `x-role: admin` | Status `revoked` + **bump `token_version`** (invalida JWTs/offline-tokens no próximo online). Outbox `LicenseRevoked`. Audit `license.revoke`. |
| Revelar | `POST /v1/licenses/:id/reveal` | `license.read` + MFA se admin (`x-mfa: verified`) + 10/h | Plaintext 1x. Audit `license.reveal` (ator/motivo, nunca a chave). Sem bulk. |

Vigência: `expires_at = starts_at + 1M/12M` (calendário UTC), `grace_until = expires_at + 3d`.
Renovação define `starts_at` na confirmação do pagamento (Fase 4 pluga `PaymentConfirmed`).

## 2. Devices

- `POST /v1/licenses/:id/devices/link` — deriva `device_hash = HMAC(secret, license_id || app_instance_id)` no backend; limite `maxDevices` (default 3/5 conforme serviço) com `COUNT` dentro da tx sob `FOR UPDATE` na linha da licença (409 `DEVICE_LIMIT`; `COUNT ... FOR UPDATE` é rejeitado pelo PG — 0A000). **Promo/bonificação (PROMO/GUEST): o limite conta máquinas distintas por IP** — reativação do mesmo IP (mesmo com `app_instance_id` novo) reafirma o device sem consumir slot; licenças pagas seguem estritas por instalação. Aceita `ip` explícito (IP local do app) com fallback p/ o IP da conexão. Outbox `DeviceLinked.v1`. Audit `device.link` (só `device_hash`).
- `POST /v1/licenses/:id/devices/unlink` — remove vínculo; hash permanece na trilha. Audit `device.unlink`.
- `POST /v1/licenses/:id/devices/:hash/block` — bloqueia; check nega `DEVICE_BLOCKED`. Audit `device.block`.
- `POST /v1/licenses/:id/validate` — decisão online (200 sempre; corpo diz allow/deny): vigência + vínculo + clone (`cloned_suspect` → `DeviceCloneSuspected.v1`). **Pública no modo chave** (app instalado sem JWT; credencial = `device_hash`) + rate-limit `devicePoll` (120/min por IP).
- LGPD: nunca hardware cru; `ip_hash` (HMAC, salt 90d) + `/24` mascarado só p/ detecção; geo-IP só em memória; **sem GPS**.

## 3. Offline-token

- Mint online: `GET /v1/licenses/:id/offline-token?device_hash=` (device `active`, licença dentro da graça). **Pública no modo chave** (mesmo fundamento do `validate`) + rate-limit `devicePoll`; no modo conta o BFF chama com o Bearer da sessão.
- `off_exp = min(iat + 7d, expires_at + 7d)`. Ver `ADR-003`.
- Validação no app: `ACTIVE` / `GRACE` (degraded) / `EXPIRED` (além da graça, mesmo com `off_exp` válido) / `OFFLINE_EXPIRED` (teto 7d, exige online) / `TOKEN_VERSION_MISMATCH` (revogado).

## 4. Filas (workers)

- `licensing.evaluate` — ticker repeat **5min** → `POST /v1/access/admin/evaluate` (`jobId` por janela `licensing-evaluate:YYYY-MM-DDTHH:MM`). Falha → retry BullMQ.
- `licensing.sync` — consome outbox licensing/access; `jobId = eventId` (dedupe), `attempts 5`, backoff exponencial 2s. Envelope inválido → **DLQ direto** (poison). Transitória esgota attempts → `licensing.dlq` com `dlq:<eventId>` preservando eventId original.
- `licensing.dlq` — sem consumidor automático; **replay manual**: inspecionar `reason`, corrigir causa, re-adicionar na `licensing.sync` com o mesmo `eventId` (idempotente por `ON CONFLICT(eventId)`).
- `communications.send` (stub Fase 3) — **TODO(Fase 4)**: Resend real com `idempotencyKey=eventId`, templates versionados (escopo §6). O stub só registra.

## 5. Auditoria / LGPD

- Eventos: `license.issue/reveal/renew/revoke`, `device.link/unlink/block`, `bonus.grant` (interceptor, fora de `/v1/licenses`).
- Metadata allowlist: `keyMasked`, `device_hash`, `tokenVersion`, `reason`, `months`, `template`, `eventId`. **Nunca**: plaintext, `key_hash`/`key_enc`, `appInstanceId`, IP raw, GPS.
- Verificar: `audit.list(action)` em e2e; produção: `SELECT` em `audit.audit_events` (append-only, 5a).

## 6. Incidentes comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| `DEVICE_LIMIT` 409 | limite atingido | `GET :id/devices`, unlink obsoleto ou ampliar `maxDevices` |
| `OFFLINE_EXPIRED` | 7d sem online | exigir online; mint novo token |
| `EXPIRED` com `off_exp` válido | além da graça | renovação (pagamento); **grace vence offline** |
| `TOKEN_VERSION_MISMATCH` / `TOKEN_STALE` | revoke/rotate | re-emitir token online |
| DLQ crescendo | consumidor/API fora | checar `reason`, API `/admin/evaluate`, replay manual |
| `CLONE_SUSPECT` | sinais impossíveis (ctr rollback, iat futuro, país) | revalidar posse, block + rotate se confirmado |

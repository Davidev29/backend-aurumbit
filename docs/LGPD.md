# LGPD — Aurum Bit (Fase 1, sem negócio)

Fonte normativa: `PROJECT.md` §4 (IP/device/geo) + `REQUIREMENTS.md` §§1/4 (retenção).
Este documento operacionaliza finalidade, base legal e retenção. Sem código de negócio.

## 1. Tabela finalidade × dado × retenção

| Dado | Finalidade | O que persiste | Base legal (LGPD) | Retenção | Descarte |
|---|---|---|---|---|---|
| IP do request | Segurança/antifraude + auditoria (detecção de abuso, lockout, trilha) | `ip_hash = HMAC(ip, salt rotativo 90d)` + `/24` mascarado p/ detecção. **Raw só em memória** no ciclo do request | Legítimo interesse (art. 7º, IX) + obrigação legal (art. 16, I — logs de acesso) | Hash 90 dias, depois purge | Job de purge; rotação do salt invalida hashes antigos |
| `device_hash` | Enforcement de limite de máquinas + detecção de clone | `HMAC(secret_rotativo, license_id \|\| app_instance_id)`. **Nunca** hardware cru (MAC/IMEI/serial) | Execução de contrato (licença) + legítimo interesse antifraude | Vida da licença + 12 meses, depois anonimiza | Revogação remove vínculo; mantém hash p/ trilha até o prazo |
| Geo por IP | **Aproximada, só em memória**, sinal `cloned_suspect` (ex. logins impossíveis). **Nunca persistida** como localização do usuário | Nada persistido; UI exibe só cidade aproximada quando já presente no evento de risco, com aviso de imprecisão | Legítimo interesse (fraude) | Não retida (memória do request) | N/A |
| GPS | **Não coletamos** | — | — | — | — |
| Chave de licença | Emissão/reemissão auditada | `key_hash` (SHA-256, UNIQUE) + `key_prefix` + `key_last4` + `key_enc` (AES-256-GCM/KMS). API/UI só `keyMasked` | Execução de contrato | Vida da licença + 5 anos (fiscal/auditoria) ou conforme política fiscal vigente | `gdpr/erase` anonimiza titular; hashes fiscais seguem obrigação legal |
| E-mail (vars de template) | Envio transacional (Resend, escopo PROJECT §6: 14 templates) | Vars mínimas p/ render; `idempotencyKey=eventId` | Execução de contrato / consentimento | 90 dias | Purge |
| Outbox | Entrega garantida de eventos | Payload sem PII sensível (redigido) | Legítimo interesse (confiabilidade) | 30 dias (purge) | Relay `SKIP LOCKED` + purge |
| Audit | Trilha append-only, particionada, sem UPDATE/DELETE | Ator/ação/motivo; PII mascarada | Obrigação legal / legítimo interesse | 5 anos | Partição fria (WORM) |
| Sessão | Refresh rotativo, reuse→revoga família | `familyId`, hashes; raw token nunca no DB | Execução de contrato | Expiração + 30 dias | Purge |
| Logs aplicação | Diagnóstico/observabilidade | JSON pino, PII redigida, `correlationId` | Legítimo interesse | 30 dias | Rotação |

## 2. Direitos do titular (`gdpr/erase`, `gdpr/export`)

- `export`: devolve dados do titular em formato portável (perfil, memberships, licenças mascaradas, consents).
- `erase`: apaga raw e identifica­dores diretos; **mantém hashes** (`ip_hash`, `device_hash`, `key_hash`) até o prazo acima quando houver obrigação legal ou legítimo interesse documentado (art. 16).
- Consents versionados: cada aceite registra `consent_version`; revogação não apaga trilha de auditoria.

## 3. Regras de implementação (para Fases 2+)

1. Nunca logar chave, senha, token, CPF cru (ver `libs/security` masking + `libs/observability` redact).
2. IP raw: variável local do request; proibido em coluna de DB, Outbox, BullMQ payload ou Resend vars.
3. Geo-IP: chamada em memória no avaliador de risco; retorno nunca atribuído a entidade persistente.
4. `device_hash`: computado no backend com segredo rotativo (KMS/env); app envia só `app_instance_id` aleatório.
5. E-mails: link opaco TTL curto; sem PII sensível no corpo (PROJECT §6).
6. Auditoria (`audit_events`, `security_events`): NUNCA nos jobs de retenção/purge — retenção de 5 anos cumprida por lifecycle de partição mensal (DETACH após 5a + export WORM antes do DROP; proibido DELETE/UPDATE). Ver `docs/RUNBOOKS/audit.md`.

## 4. Responsabilidades

- Controlador define finalidade/retenção (esta tabela); operador (Asaas/Resend) segue DPA.
- DPO: ponto de contato para ANPD/titulares; revisa esta tabela a cada mudança de finalidade.

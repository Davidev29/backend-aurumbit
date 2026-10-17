# RUNBOOK — E-mail transacional (por que o e-mail não chega)

> Status: **DIAGNÓSTICO COMPLETO — correções de e-mail NÃO implementadas.**
> Workstream separado do funil de clientes (ver §Funil adiante, que está pronto).
> Fonte do mapeamento: leitura do código em `apps/api/src/modules/communications`,
> `apps/workers/src/main.ts`, `libs/resend-adapter` + validação no stack Docker local.

## TL;DR

**A chave `RESEND_API_KEY` está correta e preenchida. O problema não é configuração
do Resend — é que nenhum processo chama a API do Resend.** O pipeline de e-mail
existe como *código testado*, mas está desconectado em três pontos. Nenhum e-mail
sai, nem em produção, mesmo com chave válida.

## Cadeia atual (o que existe)

| Etapa | Arquivo | Estado |
|---|---|---|
| Template HTML/TXT | `apps/api/src/modules/communications/templates/verify-email.ts` | ✅ pronto (14 templates) |
| Render + validação de vars | `email-templates.ts` | ✅ pronto |
| Cliente HTTP Resend | `libs/resend-adapter/src/index.ts` | ✅ pronto (idempotência, retry, webhook Svix) |
| Handler de envio | `email-sender.worker.ts` | ✅ pronto (idempotência + DLQ) |
| Store de e-mails | `email.service.ts` | ✅ pronto |
| Evento do cadastro | `auth.service.ts:195` → `auth.identity.created.v1` no outbox | ✅ emite |

## Os 3 cortes (por que nada sai)

### 1. O relay do outbox lê um banco falso 🔴

`apps/workers/src/main.ts:404` injeta um banco stub no relay:

```ts
db: { query: async () => ({ rowCount: 0, rows: [] }) },
queue: { add: async () => ({}) },
```

O `runOutboxRelayTick` está implementado e correto
(`apps/workers/src/queues/outbox.relay.ts` — claim 100, `FOR UPDATE SKIP LOCKED`,
`jobId = eventId`), mas como recebe um banco que sempre retorna vazio, **nenhum
evento sai do outbox para qualquer fila**. O próprio código admite no comentário:
*"TODO: injetar Pool PG por domínio (DATABASE_URL_*) — hoje o tick roda vazio para
não publicar fantasma"*.

### 2. O consumer de e-mail é no-op 🔴

O worker da fila (`apps/workers/src/main.ts:169-181`) registra e confirma:

```ts
logger.info({ jobId, eventId, template }, 'communications.send stub (TODO Fase 4: Resend …)');
return { stub: true };
```

O handler real (`handleEmailSendJob`, com Resend + idempotência + DLQ) **nunca é
chamado**. Há ainda um detalhe de nome: a fila do código é `communications.send`,
enquanto `comm.queues.ts` define `comm.email.send` — divergência que precisa ser
resolvida antes de ligar qualquer coisa.

### 3. Ninguém liga `auth.identity.created.v1` ao template 🔴

`email-consumer.ts` mapeia apenas tópicos de **billing** e **licensing**
(`payment-confirmed`, `license-issued`, …). O evento do cadastro
(`auth.identity.created.v1`) cai no `default: return { skip }`. E o payload do
evento tem `emailMasked` (`f***@aurum.test`) e **não** tem `email` — o mapper
exige `to` com `@`, então mesmo com o tópico mapeado ele ignoraria por falta de
destinatário.

## MailHog também não ajuda (e por isso o debug local engana)

`SMTP_HOST=mailhog` + MailHog na porta 8025 estão no compose, mas **nenhum código
fala SMTP**: o `ResendClient` faz HTTP direto para `api.resend.com`. MailHog está
orlado. Para depurar o e-mail de cadastro localmente hoje, use o helper:

```bash
bash deploy/scripts/print-verification-token.sh
```

Ele lê o token mais recente do outbox e imprime o link pronto de
`/verificar-email?token=…`.

## Correções necessárias (nenhuma foi aplicada)

1. **Injetar pools reais no relay** — `apps/workers/src/main.ts`: usar
   `DATABASE_URL_AUTH`, `DATABASE_URL_BILLING`, … por domínio em vez do stub
   (mesmo padrão de `auth-pool.provider.ts`).
2. **Unificar o nome da fila** — `communications.send` → `comm.email.send` (ou
   vice-versa), e o jobId `eventId`.
3. **Ligar o worker ao handler real** — instanciar `ResendClient`
   (`RESEND_API_KEY` + `RESEND_FROM`) e `EmailService` no worker
   `comm.email.send`; o guard de falha/DLQ já está no handler.
4. **Mapear `auth.identity.created.v1` → template `verify-email`** no
   `email-consumer.ts`, com as vars `actionUrl` e `expiresInMinutes`
   (`PUBLIC_SITE_URL`/`PORTAL_URL` + `verificationToken` do payload).
5. **Resolver o destinatário** — o payload traz `emailMasked`; ou o produtor
   passa o e-mail real (o e-mail do destinatário é PII, mas o e-mail de
   verificação **precisa** do endereço real), ou o consumidor resolve por
   `identityId`. Decisão de projeto necessária.
6. **Testar entrega de ponta a ponta** no MailHog ou num domínio Resend de teste,
   incluindo o webhook `POST /webhooks/resend` (já implementado) para
   `bounced`/`complained`.

## Por que isso não é bug do cadastro

O cadastro está correto: grava a identidade, os consents e emite
`auth.identity.created.v1`. O que falha é **apenas a entrega**. Consequência
prática: em produção, **ninguém consegue confirmar o e-mail e ninguém consegue
entrar** — o mesmo bug do `/api/me/*` (403) está bloqueando o funil do outro
lado.

---

## Funil prospect → cliente (IMPLEMENTADO E VALIDADO)

Requisito: *"sempre que um cliente iniciar o cadastro deve refletir no painel
admin como prospecção; quando ativar a conta vira cliente, mesmo sem comprar."*

### Regra

| Momento | Estágio | Origem |
|---|---|---|
| Cadastro enviado | `PROSPECT` | `auth.user_identities.status = PENDING_VERIFICATION` |
| E-mail confirmado | `ACTIVE` (Cliente) | `auth.email_verified_at` preenchido |

A transição é um **upsert idempotente e monotônico** em
`customers.customer_profiles` (o enum `CustomerStatus.PROSPECT` já existia no
schema desde a baseline). Regressão é bloqueada: um estágio decidido pelo
admin/financeiro (`PENDING_PAYMENT`, `SUSPENDED`, `CANCELLED`) **nunca** é
rebaixado pelo sync.

### Por que projeção materializada, e não evento

Não depende do relay do outbox (que é stub, §corte 1) nem de worker novo: o
`CustomerPipelineService` sincroniza na leitura. Um cadastro feito há 1 segundo
aparece como prospect no próximo load da tela, sem passo manual.

### Arquivos

- `apps/api/src/modules/customers/customer-pipeline.service.ts` — upsert + listagem + contagem
- `apps/api/src/admin/admin-customers.controller.ts` — `GET /v1/admin/customers`, `/summary`
- `apps/api/src/common/guards/staff.guard.ts` — **segurança**: role `STAFF_*` ou allowlist `ADMIN_STAFF_EMAILS`, fail-closed
- `deploy/cross-schema-read-grants.sql` — `app_customers` ganha SELECT em `auth.user_identities` (mínimo; sem DML, sem credentials/sessions/tokens)
- `apps/admin/lib/customers.ts`, `apps/admin/app/api/customers/*` — BFF
- `apps/admin/components/clientes/CustomerFunnel.tsx` — cards do funil

### Segurança (não confie em `x-role`)

O endpoint devolve PII. Um cliente do portal tem JWT válido e poderia mandar
`x-role: admin`. O `StaffGuard` barra: validado ao vivo — cliente comum com JWT
válido + header forjado → **403**.

### Validação ao vivo (stack Docker)

1. `POST /v1/auth/register` (usuário novo) → 201.
2. `GET /v1/admin/customers` → o novo cadastro aparece como **`PROSPECT`**.
3. `POST /v1/auth/verify-email` → 200.
4. `GET /v1/admin/customers` → o **mesmo** cadastro agora é **`ACTIVE`**, com
   **0 licenças** (nunca comprou) — o requisito atendido.

SQL de transição validado direto no Postgres (PROSPECT → ACTIVE, zero rebaixamentos).
16 testes unitários cobrem serviço e guard.
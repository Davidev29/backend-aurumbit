# Aurum Bit — Demonstrativo Visual da Arquitetura

> Versão renderizável: abra `docs/architecture-visual.html` no navegador. Diagramas como código (Mermaid) abaixo.

## 1. Visão de sistema (contexto)

```mermaid
flowchart LR
  P["Produtos<br/>Win / Mac / Web / App"] -->|HTTPS /v1| API["API NestJS :3000<br/>monólito modular"]
  API --> PG[("Postgres :5432<br/>banco aurumbit · 9 schemas<br/>+ PgBouncer :6432")]
  API --> RD[("Redis :6379<br/>BullMQ + cache 60s")]
  W["Workers<br/>consumers + crons"] -->|HTTP interno<br/>x-internal-key| API
  W --> RD
  W --> PG
  API -->|webhook| AS["Asaas<br/>Sandbox-first"]
  AS -->|webhook + recon| API
  API -->|eventos| RS["Resend<br/>14 templates"] 
  AD["Admin Next.js :3001<br/>BFF httpOnly"] -->|proxy ou mock| API
  MH["Mailhog :8025"] -.->|SMTP local| API
```

## 2. Contêineres e bancos por domínio

```mermaid
flowchart TB
  subgraph API2["apps/api — módulos"]
    A1[auth] --- A2[customers] --- A3[products] --- A4[access] --- A5[licensing] --- A6[billing] --- A7[finance] --- A8[audit] --- A9[communications]
  end
  A1 -->|String opaco, sem FK cross| DB1[("auth_db")]
  A2 --> DB2[("customers_db")]
  A3 --> DB3[("products_db")]
  A4 --> DB4[("access_db")]
  A5 --> DB5[("licensing_db")]
  A6 --> DB6[("billing_db")]
  A7 --> DB7[("finance_db")]
  A8 --> DB8[("audit_db")]
  A9 --> DB9[("communications_db")]
```

## 3. Comunicação assíncrona (Outbox + BullMQ)

```mermaid
sequenceDiagram
  participant App as Caso de uso (txn PG)
  participant OB as outbox_events (eventId UNIQUE)
  participant RL as Relay (SKIP LOCKED 100)
  participant Q as BullMQ (jobId=eventId, 5x exp, DLQ)
  participant WK as Worker (aplica via API interna)
  App->>OB: INSERT na mesma txn
  RL->>OB: claim + publish + mark published
  RL->>Q: publica
  Q->>WK: entrega
  WK->>App: POST internal + x-internal-key
  Note over Q,WK: replay = duplicate 200 · ilegal = REJECTED · fora-de-ordem nunca regride
```

## 4. Fluxo canônico de compra

```mermaid
flowchart LR
  O[Order] --> I[Invoice pending] --> C[Asaas charge] --> WH[webhook RECEIVED]
  WH --> V[VALIDATED] --> AP[APPLIED: Payment CONFIRMED]
  AP --> OB2[outbox PaymentConfirmed]
  OB2 --> FQ[billing.fanout]
  FQ --> AC[access: Entitlement] & LC[licensing: License] & FI[finance: Receivable+Transaction] & EM[email payment-confirmed]
```

## 5. Licença: validade × graça × offline

```mermaid
timeline
  title Licença mensal (starts_at = PaymentConfirmed)
  section Vigência
    starts_at : ALLOW
    expires_at : ALLOW até aqui
    grace_until (+3d) : ALLOW degradado
    após grace : DENY EXPIRED (mesmo com off_exp válido)
  section Offline
    token_iat : emitido online (device active)
    off_exp = min(iat+7d, expires+7d) : teto sem contato
    após off_exp : DENY OFFLINE_EXPIRED (exige online)
```

## 6. Papéis e finance.read escopado

```mermaid
flowchart TB
  ADM["admin<br/>total + MFA"] --> M1[finance.manage] & B1[billing.manage] & R1[reveal + replay DLQ]
  MGR["manager<br/>operacional"] --> B2[billing.read] & FQ2{"finance.read?<br/>default deny"}
  FQ2 -->|concessão explícita por org + motivo + audit| FR[finance.read escopado]
  USR["user<br/>limitado"] --> NO["sem financeiro / sem bônus"]
```

## 7. Legenda de filas e crons

| Fila | Gatilho | DLQ |
|---|---|---|
| licensing.evaluate | repeat 5min | log |
| licensing.sync | outbox | licensing.dlq |
| billing.webhook.apply | webhook/recon | billing.dlq |
| billing.recon | 1h + daily 03:00 SP | log |
| billing.fanout | PaymentConfirmed | billing.fanout.dlq |
| finance.sync | outbox billing | finance.dlq |
| finance.projection.compute | 202/recompute | finance.dlq |
| comm.email.send | fanout | comm.email.dlq |
| outbox relay | 30s × 9 schemas | — |

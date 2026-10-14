# ADR-001 — Monólito modular NestJS

- Status: **aceita** (vinculante, `PROJECT.md` — decisões)
- Data: 2026-10-10 · Fase 1 (fundação, sem negócio)

## Contexto

Ecossistema Aurum Bit: produtos Windows/Mac + terminal web + app, backend plataforma e terminal administrativo Next.js. Time enxuto, 9 domínios de dados (auth, customers, products, access, licensing, billing, finance, audit, communications), integrações Asaas (sandbox-first) e Resend. Exigência Fase 1: `clone → compose → migrate → seed → /health/ready 200` em <10 min.

## Decisão

**Monólito modular NestJS** (`apps/api` + `apps/workers`), com:

- Módulos por domínio com fronteiras explícitas (`libs/contracts`, `libs/events` envelope `*.v1`).
- **Banco por domínio**: 1 Postgres físico, 9 databases lógicos; Prisma 1 schema por domínio; **sem FK cross-DB** (relações por ID lógico + eventos).
- **Outbox PG + BullMQ/Redis**: worker publica, consumidores idempotentes (`eventId`, `jobId=eventId`), retry + DLQ. Redis nunca é fonte definitiva.
- Admin em Next.js App Router separado (`apps/admin`), menu por permissões do backend.

## Alternativas consideradas

| Alternativa | Por que não (agora) |
|---|---|
| Microserviços (1 deploy por domínio) | Custo operacional (9 pipelines, 9 deploys, rede, tracing distribuído) incompatível com time/fase atual; quebra o aceite <10 min |
| Monolito single-DB com schemas | Acoplamento via FK cross-domínio dificulta extração futura e quebra a regra "sem FK cross-DB" |
| Serverless por endpoint | Cold-start e limites de conexão PG/Prisma; check-access p99 <50 ms (REQUIREMENTS §2) fica frágil |

## Consequências

- (+) Um pipeline CI/CD, um compose local, observabilidade única (`/metrics`, `x-correlation-id`).
- (+) Extração futura é mecânica: módulo + seu DB + seus tópicos já isolados.
- (−) Deploy acoplado: mudança em billing redeploya auth (mitigado com testes por domínio + migrate backward-compatible).
- (−) Escala vertical primeiro; horizontal via réplicas stateless + workers (Redis só fila/cache).

## Gatilhos de extração (só com motivo concreto)

Extrair um serviço **somente se** ≥1 gatilho persistir por ≥2 milestones:

1. Deploy independente exigido (ex. billing com janela regulatória própria).
2. Escala assimétrica (ex. workers de reconciliação saturam CPU do monolito).
3. Time/cognitivo (≥2 times esbarrando no mesmo módulo com conflitos semanais).
4. p99/SLO: check-access ou webhook ack (<2 s) estourado por contenção interna.

Fora isso, modularizar internamente (novos módulos `libs/*`, filas dedicadas).

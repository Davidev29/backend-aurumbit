# PHASE-8-PLAN.md — Modelo comercial: licença × assinatura + web limitada (2026-10-14)

## 1. Objetivo
Distinguir de verdade `ONE_TIME` (desktop perpétuo) de `MONTH/YEAR` (SaaS web):
`billingInterval` validado em Subscription/Invoice, `kind=lifetime` no
licensing, capabilities `WEB_*` vs `DESKTOP_*` (channel em
Feature/Entitlement/offline-JWT), gating server-side + matriz replicada na
web, checkout pós-pagamento real (Asaas→licença, sem tela `done` sem cobrança).

## 2. Contexto travado
- Fases 1–7 entregues (STATE.md). Fase 7: compose prod, Caddy, backup DR,
  runbooks, seed real, `unit 429/429`.
- Débito pago nesta fase: **nenhum domínio tinha `migrations/`**
  (`migrate deploy` falhava) → `0001_baseline` gerado (from-empty) nos 9.
- Sem FK cross-DB; outbox + consumidores idempotentes; preço imutável por linha.

## 3. Tracer primeiro (T0)
Plano `ONE_TIME` fim a fim em nível de serviço (sem Asaas real):
create plan ONE_TIME → checkout PENDING → PaymentConfirmed (mesmo eventId 2x)
→ 1 licença `lifetime` (expiresAt null) → `check-access` channel=DESKTOP ALLOW
`LIFETIME`, channel=WEB DENY `CHANNEL_MISMATCH` → 2ª entrega DUPLICATE sem
2ª licença. Só expande com o tracer verde.

## 4. Tarefas
| # | Tarefa | Verificação |
|---|--------|-------------|
| T1 | `billingInterval` em Subscription/Invoice (coluna + validação `MONTH\|YEAR\|ONE_TIME` no service/DTO; `0002_fase8` delta) | unit: intervalo inválido → 400; válido persiste; `migrate diff` vazio pós-0002 |
| T2 | `kind=lifetime` (LicenseKind, `calcExpiry` → expires/grace null, renew de lifetime → 409 `LIFETIME_NO_RENEW`, upgrade p/ lifetime ok; sem migration — coluna já string) | unit: lifetime sem expiração; effectiveStatus active; renew bloqueado |
| T3 | Channel (Feature.channel + Entitlement.channel default `BOTH`, check-access filtra por channel, offline-JWT `ch` + helper, sync propaga; `0002_fase8` delta) | unit: BOTH passa nos dois; WEB negado no DESKTOP (`CHANNEL_MISMATCH`); token adulterado inválido |
| T4 | Gating server-side (check DTO + cache key com channel) + matriz web replicada (`portal/lib/capabilities.ts`, badges no checkout/dashboard a partir da API) | unit cache key; UI nunca autoriza sozinha (só reflete a API) |
| T5 | Checkout real (PG `createCheckoutOrder` PENDING idempotente por orderId; `issueFromPayment` claim-first por eventId; endpoint interno; BFF sem stub `done`; portal PENDING + polling, `done` só com licença) | unit+e2e: sem cobrança→sem licença; duplicata→1 licença; BFF sem API→502 |
| T6 | Catálogo: plano `ONE_TIME` + features `WEB_ACCESS`/`DESKTOP_APP` (seed-prod + mocks dev) | seed idempotente; vitrine exibe perpétuo × assinatura |
| T7 | Carry-over Fase 7: guarda fail-closed nas rotas BFF restantes (auth/me/licenses/checkout/activate) | `grep API_INTERNAL_URL` direto = 0 nas rotas; prod sem upstream → 502 |
| T8 | Docs (`commercial.md`), inventory, REPORT, STATE | terceiro entende a matriz só pelo doc |

## 5. Gates de reversibilidade
- Plano ONE_TIME emitido errado: arquivar linha + sucessora (imutabilidade preservada; licenças já emitidas seguem vitalícias — one-way door: revisar preço antes de ativar).
- Licença lifetime emitida: irreversível por desenho (só revogação). Checkpoint: `issueFromPayment` só via PaymentConfirmed real.
- Migration 0002: aditiva (colunas nullable/default) — rollback = `migrate resolve --rolled-back` + código anterior.

## 6. Qualidade
`lint → typecheck → test (429+, sem regressão) → build → prisma validate (9) → bash -n`. Sem threshold novo além do plano. Asaas real e DNS fora de escopo (já cobertos Fase 7).

## 7. Riscos
- Kind legado `monthly/annual` (minúsculas) vs `billingInterval` (MAIÚSCULAS): mapear na camada de consumo, nunca renomear dado existente.
- `check-access` cache: chave sem channel vazaria ALLOW entre canais — T4 inclui channel na chave.
- Offline-JWT antigo (sem `ch`): app trata ausente como `BOTH` + re-mint no próximo online (compat, sem quebrar clientes).
- In-memory flow service (legado): Fase 8 mira o path PG canônico; flow recebe só `kind` estendido se trivial.

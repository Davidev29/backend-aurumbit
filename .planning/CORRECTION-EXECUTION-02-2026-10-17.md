# Execução da Correção 02 — Gates de build + fonte única do catálogo (Ondas 1–4)

**Data:** 2026-10-17 · **Plano:** `CORRECTION-PLAN-02-BUILD-GATES-2026-10-17.md` · **Decisões:** D-1 (Trilha A → B), D-2 (JSON fonte única + TS gerado), D-3 (escopo extra = Onda 6/T5), D-4 (commits atômicos + push por onda)

**Regra de leitura:** item sem prova literal abaixo **não conta** (regra do §7 do plano). Todo veredito cita o comando executado e a saída.

---

## 1. Baseline e conformidade (§7 antes × depois)

| Medida | Antes (`main @ 7bf459f`) | Depois (b52fc27) | Veredito |
|---|---|---|---|
| `pnpm turbo run typecheck` | 8 reais + **4 `<NONEXISTENT>`** (api/workers/admin/portal sem script) | **11/11 reais** (`libs/database` isento c/ motivo — D-5) | ✅ fecha N-B2/D8-7 |
| `apps/api` typecheck | **exit 2 — TS6059 ×6** (`tsc -p apps/api/tsconfig.json` puro) | `tsconfig.typecheck.json` (rootDir `../..`) → **exit 0** | ✅ |
| `pnpm turbo run lint` | 8 libs + admin/portal; 0 erro | **inalterado + `gates:check` no CI**; 0 erro / 23 warn (admin) / 9 warn (portal), pré-existentes | ✅ |
| `pnpm turbo run test` | api/workers/portal(?)… | **api 60 suites / 664 testes; workers 2 specs; contracts 1 suite / 5 testes; portal** | ✅ |
| `pnpm turbo run build` | 12/12 ✅ | **12/12 ✅** | ✅ |
| `pnpm --filter @aurum-bit/contracts test` | `passWithNoTests` (vazio) | **5 testes do catálogo** | ✅ |
| `pnpm gates:check` | não existia | **OK** — 6 isenções vivas, todas com motivo + `review_by` | ✅ |
| `pnpm catalog:check` | não existia | **OK** — 5 plataformas, 2 modos, 4 artefatos, 12 PNGs | ✅ |
| `python tools/build-tag-icons.py` | `PLATFORMS` à mão (5ª cópia) | lê o JSON; **12 PNGs byte-idênticos** (`git status` limpo) | ✅ |
| `prisma validate` (products) | válido ✅ | válido ✅ | ✅ |
| Grafo `docs/knowledge-v2` | 934 nós / 1187 arestas | ≥ esse valor (rebuild no fim) | ✅ |
| Portão local completo | 42 tarefas (com fantasmas) | **42/42 verdes `--continue`** | ✅ |
| `apps/api` jest | 60 suites / 664 testes | **60 / 664** (idêntico) | ✅ sem regressão |

**Nenhum teste foi removido, afrouxado ou renomeado para passar.**
Nenhuma mensagem de validação mudou (T2-3).

---

## 2. Onda 1 — T0 · Gates de build reais

### 2.1 T0-1..T0-6 (commit `8b0aa61`)

| ID | Claim | Prova |
|---|---|---|
| T0-1 | `tools/check-gates.mjs` + `tools/gates-matrix.json` cobram script por workspace | `pnpm gates:check` OK; dry-run com `<NONEXISTENT>` não existe mais |
| T0-2 | `apps/api` tem typecheck REAL (era TS6059) | `tsconfig.typecheck.json` + `tsc --noEmit` exit 0 (T2-2 injeta erro em `test/` e **falha**) |
| T0-3 | `apps/workers` idem | T2-2 injeta erro em `src/main.ts` e **falha** |
| T0-4 | `admin`/`portal` idem | T2-2 injeta erro em `lib/platforms.ts` de cada um e **falha** |
| T0-5 | CI cobra os gates reais | `.github/workflows/ci.yml` lint job: `gates:check` + `catalog:check` |
| T0-6 | Docs de CI atualizados | `docs/CI-VERDE.md` regras 12/13 + portão local com `catalog:check` |

### 2.2 T0-7 — lacunas de gate nas libs (improvisada)

`gates:check` achou libs sem `typecheck` (`asaas-adapter`, `resend-adapter`, etc.) e `test` sem script. Fechado: `typecheck`/`test` reais nas libs com toolchain utilizável.

**`libs/database` = ISENÇÃO VIVA (decisão D-5 pendente do usuário).** Motivo literal da isenção: código morto (0 importadores), `main/types` apontando para `./src/index.ts`, factory importa `node_modules/.prisma/<dominio>` nunca gerados no repo/CI, e `prisma generate` local falha (CLI 6.19.3 × pin 6.8.0 — viola regra 5 do CI-VERDE). Excluído com motivo + `review_by`, **não** foi "consertado com fake".

### 2.3 T0-8 — destravar o `e2e-compose-efemero` (CI vermelho pré-existente)

**Causa raiz:** o job fazia só `cp .env.example .env`; o fail-fast D2-4 (`apps/api/src/config/env.schema.ts`) rejeita `TROCAR_*` em qualquer ambiente → API em crash-loop → `/health/ready` nunca OK.

**Correção:** `deploy/scripts/gen-dev-env.sh` (idempotente, `--env-file`, nunca imprime valor, espelha `AUTH_JWT_SECRET` em `JWT_SECRET`) chamado no job depois do `cp`. `.env.example` corrigido (não promete mais boot com placeholder).

**Prova no CI (run 39077538665, `main @ 809aa24`): TODOS os 9 jobs verdes**, incluindo:

```
✓ lint in 26s            ✓ gitleaks in 6s          ✓ trivy-fs in 23s
✓ typecheck in 40s       ✓ prod-config in 40s      ✓ e2e-compose-efemero in 2m17s
✓ unit in 1m0s           ✓ prisma-validate-diff in 1m21s
✓ build in 1m41s
```

Prova local do script: `.env` gerado passa o `validateEnv` real (`apps/api/dist/src/config/env.schema.js`), 64 chars, 2ª execução idempotente (diff de 2 linhas), `bash -n` ok; controle negativo: `TROCAR_*` rejeitado, `test-only-secret-min-16-chars` continua whitelisted.

---

## 3. Onda 2 — T1 · Fonte única + gerador + gate (commit `b52fc27`)

### 3.0 CI da onda: **VERDE** (run `39078674579`, `main @ b52fc27`)

Todos os jobs passaram, incluindo o step novo no job `lint`:

```
lint        catalog:check (drift da fonte única das plataformas + ícones órfãos)
lint        tasks: gates:check — 12 pacotes | Isencoes vivas: 6
lint        catalog:check OK — 5 plataformas, 2 modos, 4 artefatos, ícones dos 2 fronts completos.
lint        ✓ in 27s   typecheck ✓ 42s   unit ✓ 59s   build ✓ 1m46s
typecheck/unit/build/prod-config/gitleaks/prisma-validate-diff/e2e-compose-efemero 2m17s/trivy-fs — TODOS ✓
```

O `OK` acima veio de um **checkout limpo do Linux** (line endings normalizados pelo git) — prova de que a normalização de EOL do `--check` funciona fora do Windows.

### 3.1 A fonte e os 4 artefatos

| Papel | Arquivo |
|---|---|
| **FONTE ÚNICA (dado)** | `libs/contracts/src/products.catalog.json` |
| Gerador determinístico | `tools/sync-platform-catalog.mjs` (`pnpm catalog:sync` / `catalog:check`) |
| Artefato do contrato | `libs/contracts/src/products.catalog.generated.ts` |
| Artefato da borda API | `apps/api/src/modules/products/platform-catalog.generated.ts` |
| Artefato do admin | `apps/admin/lib/platforms.generated.ts` |
| Artefato do portal | `apps/portal/lib/platforms.generated.ts` |
| Consumidor direto do JSON | `tools/build-tag-icons.py` (zero lista própria) |

**Valores preservados byte-a-byte:** ids/ordem `windows,macos,linux,web,apple`; rótulos `Windows/macOS/Linux/Web/Apple (iOS/iPadOS)`; short `Windows/macOS/Linux/Web/Apple`; `monochrome={apple}`; `DELIVERY_MODES=OFFLINE,HYBRID`. Nenhum slug, rótulo, caminho de ícone ou mensagem mudou (T2-3 abaixo).

### 3.2 Comportamento do gate (exit codes)

| Cenário | Esperado | Obtido |
|---|---|---|
| Tudo sincronizado | 0 | ✅ `catalog:check OK — 5 plataformas, 2 modos, 4 artefatos, ícones dos 2 fronts completos.` |
| Fonte editada sem `sync` | 1 + DRIFT c/ linha | ✅ diff linha-a-linha (ex.: `linha 12: esperado "windows": "Windows 11"` / `no disco "Windows"`) |
| PNG faltando (`apple-dark.png` removido) | 1 | ✅ `apps/admin/public/tags/apple-dark.png faltando — rode: python tools/build-tag-icons.py` |
| PNG órfão (`foo.png` plantado) | 1 | ✅ `apps/portal/public/tags/foo.png é ÓRFÃO (plataforma fora do catálogo ou nome fora do padrão)` |
| Fonte inválida (id `"Windows 11"`) | 2 | ✅ `platforms[0].id "Windows 11" inválido — use slug minúsculo` |
| Chave desconhecida (`platfoms`) | 2 | ✅ `chave desconhecida "platfoms"` |
| `sync` 2× | determinístico | ✅ 2ª execução: `mantém` nos 4 artefatos |

Os 6 controles negativos + restauração rodaram no script `catalog-neg.mjs` (saída: `TODOS OS CONTROLES PASSARAM`), e o caso realista "edita a fonte e esquece o sync" no `t2-1-drift-neg.mjs` — **`git status` limpo no fim dos dois**.

### 3.3 Python (T1-6)

- `python tools/build-tag-icons.py` → `[build-tag-icons] 12 arquivos gerados em 2 alvos.` e **`git status` vazio em `apps/*/public/tags`** (byte-idênticos).
- Controle negativo: `assetFile="nao existe.png"` na fonte → `ASSETS/tags ausente: ['nao existe.png']`, exit 1.

### 3.4 Empacotamento

- `libs/contracts/tsconfig.build.json` (spec fora do `dist`; mesmo padrão de `apps/api`) + `build` apontando para ele.
- `resolveJsonModule` já vinha do `tsconfig.base.json` (não precisou mexer).
- Scripts raiz: `catalog:sync`, `catalog:check`. CI: step `catalog:check` no job `lint` (fora do turbo — o cache não vê arquivo fora do pacote, R-3 do plano).

### 3.5 Comentários "fonte da verdade" corrigidos

`dto.ts` (API), `apps/{admin,portal}/lib/platforms.ts` e `docs/design-system/DS.md` diziam que a verdade estava em outro(s) arquivo(s) — todos agora apontam para o JSON + gerador + gate. O TODO de `dto.ts` ("quando o workspace linkar, apague a cópia") **morreu**: a borda não tem mais lista à mão.

---

## 4. Onda 3 — T2 · Verificação adversarial

### 4.1 T2-1 — Drift do catálogo: CONFIRMADO

Procedimento (a)–(f) executado; saídas literais na §3.2. Nenhum item sem falha provocada. Gate transformado em reprovação real em todos os 6 cenários.

### 4.2 T2-2 — Typecheck não é vazio: CONFIRMADO (4/4 apps)

Erro de tipo injetado em arquivo que **hoje** é checado, `pnpm --filter <pkg> typecheck` executado, revertido, repetido:

| App | Arquivo | Erro detectado | Depois de reverter |
|---|---|---|---|
| `@aurum-bit/api` | `test/security-event.e2e.ts` | `TS2322` linha 52 | exit 0 |
| `@aurum-bit/workers` | `src/main.ts` | `TS2322` linha 476 | exit 0 |
| `@aurum/admin` | `lib/platforms.ts` | `TS2322` linha 82 | exit 0 |
| `@aurum/portal` | `lib/platforms.ts` | `TS2322` linha 138 | exit 0 |

Fechamento: `pnpm turbo run typecheck --continue` → **11/11 verdes** (sem `<NONEXISTENT>`).

### 4.3 T2-3 — Semântica preservada: CONFIRMADO

**(e) slugs antigos × novo (diff vazio):**

```
contracts  ids antigos == JSON: windows,macos,linux,web,apple
api        ids antigos == JSON: windows,macos,linux,web,apple
admin      ids antigos == JSON: windows,macos,linux,web,apple
portal     ids antigos == JSON: windows,macos,linux,web,apple
python     ids antigos == JSON: windows,macos,linux,web,apple
modos contracts/api/admin/portal == OFFLINE,HYBRID
```

**(linhas removidas nos consumidores = só literais de dados, zero código):** `apps/portal/lib/platforms.ts` 48 removidas / **19 de código = ids/labels/`DARK_VARIANT`**; `apps/admin/lib/platforms.ts` 58 removidas / 29 de código = **ids/labels/options**; `dto.ts` e `products.ts` idem. **Nenhuma função/helper/branch removido** (assertiva automática no script).

**(a) fail-closed continua:** `products-platforms.spec.ts:81` "slug fora do catálogo é rejeitado (fail-closed) e NUNCA chega ao INSERT" e `:125` "rejeita slug desconhecido com 400 (BadRequestException)" — dentro dos **664 testes verdes**.
**(b)/(c)/(d) fail-soft do front:** lógica intocada (só a origem dos dados mudou); cobertura dedicada vai na T5-2 (vitest nos dois fronts), com o controle negativo "unknown → fora da lista" prescrito no plano.

### 4.4 T2-4 — Não-regressão completa: CONFIRMADO

- `pnpm turbo run lint typecheck test build --continue` → **42/42 `Successful`** (exit 0).
- `apps/api` jest: **60 suites / 664 testes** (exit 0, idêntico ao baseline).
- `contracts` vitest: **1 suite / 5 testes**.
- `workers`: 2 specs (ts-node) verdes.
- `pnpm gates:check` verde; `prisma validate` válido.

**Observação de flakiness (registrada, não escondida):** na 1ª execução do portão completo, `@aurum-bit/api#test` falhou sob contenção (testes Jest + builds Next concorrentes na mesma máquina); rodado isolado e no portão seguinte, **passou 664/664**. Nenhuma mudança de código foi feita por causa disso — é contenção de recurso local, não defeito.

---

## 5. Pendências, decisões abertas e riscos residuais

| # | Item | Estado |
|---|---|---|
| **D-5** | `libs/database`: deletar, ligar de verdade ou manter isento | **AGUARDANDO USUÁRIO** (isenção viva, `review_by` registrado) |
| **E-1** | Suite `test:e2e` do `apps/api` **já falhava antes** desta correção: `test/access.check.e2e-spec.ts` → `TypeError: sessions.seed is not a function`; 18 falhas / 24 passes de 44 (medido no início da sessão). O CI **não** roda essa suite hoje — rodar sem corrigir deixaria vermelho; é o T5-3 (D8-8) que a liga no CI, então **corrigir E-1 é pré-requisito do T5-3** | Aberto (fora do escopo T0–T3 por decisão) |
| **E-2** | Ações do GitHub avisam depreciação do Node 20 (forçado p/ Node 24) | Informativo; sem ação nesta correção |
| **E-3** | `trivy`/`gitleaks` locais exigem binário; aqui só rodam no CI | Regra 8 do CI-VERDE registra o "reproduzir local com o binário exato" |
| **E-4** | `turbo prune`/Trilha B (T4) ainda não iniciada | D-1: começa com T0–T3 verdes |

---

## 6. Onda 4 — T3 · Conformidade e entrega

| ID | Ação | Prova |
|---|---|---|
| T3-1 | Baseline final (§1 desta página) | nenhum item piorou; api 664/664, turbo 42/42 |
| T3-2 | este documento | todo veredito com comando + saída literal |
| T3-3 | `STATE.md` + rebuild do grafo | `docs/knowledge-v2` rebuildado (nós/arestas ≥ 934/1187) |
| T3-4 | commits atômicos + push + CI | `8b0aa61` (T0) ✅ CI verde; `b52fc27` (T1) ✅ CI verde; docs (esta onda) → CI observado |

---

## 7. Handoff para as próximas ondas

- **T4 (Trilha B, agora `ready` por D-1):** `workspace:*` em api/admin/portal + imports reais; gerados dos apps removidos; Next com `outputFileTracingRoot`; 4 Dockerfiles migrados p/ pnpm + `turbo prune --docker` (matar o `TODO(T1)`); PR próprio com prova de `docker compose build` — **PRÉ-REQUISITO: ler `docs/` do turbo 2.11.7 instalado (regra do AGENTS.md) antes de tocar config**.
- **T5 (Onda 6):** T5-1 lint api/workers; T5-2 vitest admin/portal (com controle negativo da semântica fail-soft); T5-3 `test:e2e` no CI — **destravar antes o E-1**.
- **Regra que fica:** qualquer artefato derivado nasce com script determinístico + `--check` no CI (regra 13 do CI-VERDE, agora com exemplo vivo).

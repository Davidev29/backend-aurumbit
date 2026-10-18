# Execução da Correção 02 — Gates de build + fonte única do catálogo (Ondas 1–6)

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
| **E-1** | ~~Suite `test:e2e` do `apps/api` **já falhava antes** desta correção...~~ **RESOLVIDO (T5-3)**: os specs usam os repos em memória via `.seed()`, mas sem `AUTH_REPO` o `GuardsModule` injetava `PgSessionLookup` (sem `.seed`) → `TypeError: sessions.seed is not a function` (18 failed / 24 passed de 44). Fix: `process.env.AUTH_REPO ??= 'memory'` no `setup-e2e.ts` + passo no job `unit` do CI | **Fechado** — 42 passed + 2 skipped, exit 0 (local com env do CI; §8.3) |
| **E-2** | Ações do GitHub avisam depreciação do Node 20 (forçado p/ Node 24) | Informativo; sem ação nesta correção |
| **E-3** | `trivy`/`gitleaks` locais exigem binário; aqui só rodam no CI | Regra 8 do CI-VERDE registra o "reproduzir local com o binário exato" |
| **E-4** | ~~`turbo prune`/Trilha B (T4) ainda não iniciada~~ | **Fechado** — T4 executada em 2026-10-17 (branch `feat/t4-workspace-deps-prune`, PR próprio; evidência em §7) |

---

## 6. Onda 4 — T3 · Conformidade e entrega

| ID | Ação | Prova |
|---|---|---|
| T3-1 | Baseline final (§1 desta página) | nenhum item piorou; api 664/664, turbo 42/42 |
| T3-2 | este documento | todo veredito com comando + saída literal |
| T3-3 | `STATE.md` + rebuild do grafo | `docs/knowledge-v2` rebuildado (nós/arestas ≥ 934/1187) |
| T3-4 | commits atômicos + push + CI | `8b0aa61` (T0) ✅ CI verde; `b52fc27` (T1) ✅ CI verde; docs (esta onda) → CI observado |

---

## 7. Onda 5 — T4 · Unificação real (workspace + Docker pnpm/prune)

Branch `feat/t4-workspace-deps-prune` (PR próprio, D-1); base `0fa813e` (CI verde, 9/9).

### 7.1 T4-1 — regra do turbo instalado (AGENTS.md)

- Lidos `prune.mdx` e `docker.mdx` do turbo **2.11.7 instalado** (versão do repo) antes de tocar config:
  - `turbo prune <pkg> --docker` → `out/json/` (manifests + `pnpm-lock.yaml` podado) e `out/full/` (fontes do pacote e deps);
  - standalone binário exige **≥ 2.11.5** → pinado 2.11.7 com verificação de `SHA256SUMS` e asserção do tar (`= turbo`).
- Docker local 29.7.2; recon do prune antes de escrever os Dockerfiles: `out/json` = manifests + lockfile podado; `out/full` = apps + libs + raiz, **sem** `tsconfig.base.json` (não é package.json → COPY explícito no builder).

### 7.2 T4-2 — fim das cópias por app (consumidores reais do pacote)

| Claim | Arquivo (pós-mudança) | Antes → Depois |
|---|---|---|
| Apps declaram o contrato | `apps/api/package.json:17`, `apps/admin/package.json:13`, `apps/portal/package.json:13` | (ausente) → `"@aurum-bit/contracts": "workspace:*"` |
| Borda da API | `apps/api/src/modules/products/dto.ts:22` | import de `./platform-catalog.generated` → `@aurum-bit/contracts` (reexports públicos do módulo mantidos: `PRODUCT_PLATFORM_IDS`/`PRODUCT_DELIVERY_MODES`) |
| Admin | `apps/admin/lib/platforms.ts:15` | idem (`PRODUCT_PLATFORMS` derivado do pacote, mesma ordem canônica) |
| Portal | `apps/portal/lib/platforms.ts` | idem |
| Export que só o admin tinha | `libs/contracts/src/products.ts:47` | `MONOCHROME_PLATFORMS` (catálogo agora expõe os 3 literais) |
| Gerados por app removidos | `apps/api/src/modules/products/platform-catalog.generated.ts`, `apps/admin/lib/platforms.generated.ts`, `apps/portal/lib/platforms.generated.ts` | 3 arquivos deletados (fim das cópias) |
| `turbo test` espera o build das deps | `turbo.json:9` | `"test": { "dependsOn": ["^build"] }` — o unit da api importa o `dist` do contrato via link do workspace |
| Jest da api não recompila o dist do contrato | `apps/api/package.json:65` | `transformIgnorePatterns` com `libs[\\/]contracts[\\/]dist/` → 0 avisos do ts-jest |

Verificação (portão local completo pós-mudanças, log literal): `pnpm turbo run lint typecheck test build --continue` → **`Tasks: 42 successful, 42 total` / `SUITE_EXIT=0`**; api `60 passed / 664 passed`; contracts `1 passed / 5 passed`; workers `tests 5 / pass 5` + `tests 7 / pass 7`; lint **0 erros** (warnings pré-existentes: admin 23, portal 9). Gatilho de execução: `pnpm catalog:check` → `catalog:check OK — 5 plataformas, 2 modos, 1 artefato, consumidores via workspace:*, ícones dos 2 fronts completos.`

### 7.3 T4-3 — tracing root do standalone (e o lockfile que o sequestrava)

O 1º build Docker saiu **assimétrico**: standalone do admin no layout antigo (`server.js` na raiz) e o do portal aninhado. O config serializado no `server.js` de cada um provou a causa:

| app | `config.outputFileTracingRoot` (nosso) | `config.experimental.outputFileTracingRoot` (efetivo) |
|---|---|---|
| admin | `/app` | **`/app/apps/admin`** (default auto-detectado) |
| portal | `/app` | `/app` (auto-detectado na raiz) |

Causa raiz: no **Next 14.2** o top-level `outputFileTracingRoot` existe no schema mas nenhum código o lê para o trace (`next/dist/build/index.js` usa `config.experimental.outputFileTracingRoot`); sem valor explícito o Next chama `findRootDir` e usa o **lockfile mais próximo** — o `apps/admin/package-lock.json` legado (restaurado numa auditoria antiga p/ o Dockerfile npm) parava a busca em `apps/admin`; o portal "deu sorte" (sem lockfile local, subiu até o `pnpm-lock.yaml` da raiz). Correção em 2 frentes:

- `apps/admin/next.config.js:57` e `apps/portal/next.config.js:57` — `output`/`experimental: { outputFileTracingRoot: REPO_ROOT }` + top-level mantido p/ Next 15 (`REPO_ROOT = path.join(__dirname, "../..")`).
- `git rm apps/admin/package-lock.json` — 2.393 linhas de lock npm num workspace pnpm, sem referência viva.

Prova (rebuild `--no-cache`): `/app/apps/admin/server.js` (4.560B) presente e `/app/libs/` traçado; `id -un` → `nextjs` nas 2 imagens; boot dos 2 standalone: admin `/login` **200**, `/` **307**; portal `/` **200**, `/checkout` **200**; SSR do portal renderiza o catálogo (HTML contém `Windows` e `macOS`); grep nos chunks server: **0** ocorrências de `aurum-bit/contracts` → webpack bundleou o pacote (não há `require` do pacote em runtime; por isso `libs/contracts` no standalone só leva `package.json`).

### 7.4 T4-4 — 4 Dockerfiles: pnpm + `turbo prune --docker`

Padrão único nos 4 (`apps/{api,workers,admin,portal}/Dockerfile`): `base` (node:22-alpine + pnpm 9.0.0) → `prepare` (turbo 2.11.7 verificado por SHA256 + `turbo prune --docker`) → `deps` (`out/json` + `pnpm install --frozen-lockfile`) → `builder` (`out/full` + `tsconfig.base.json` + `turbo run build --filter=<pkg>`) → `runner` (`pnpm install --prod` p/ api/workers; standalone do Next p/ admin/portal; todos **non-root**). `TODO(T1)` morto.

O caminho revelou (e fechou com prova) um vazamento silencioso:

- **`*.tsbuildinfo` no prune**: o `.gitignore` fica **fora** do contexto Docker, então o prune copiava os `.tsbuildinfo` do working tree; o tsc incremental então **pulava a emissão** do `contracts` (imagem com 6 `.d.ts` e sem `dist/index.js`) e a api quebrava em runtime (`MODULE_NOT_FOUND .../contracts/dist/index.js`). Fix: `.dockerignore` com `**/*.tsbuildinfo`/`**/.turbo/`/`**/*.log` + `RUN find . -name '*.tsbuildinfo' -delete` antes do prune. Prova: rebuild limpo → `libs/contracts/dist` com 21 arquivos / 7 `.js`.
- **`tsconfig.base.json` não entra no prune** (não é package.json) → COPY explícito nos 4 builders.

Runtime das imagens (smoke direto): api resolve o contrato (`plataformas: windows,macos,linux,web,apple` / `modos: OFFLINE,HYBRID`), usuário `nestjs`, 521MB; workers `dist/main.js`, 333MB; admin 288MB; portal 318MB (antes: admin 701MB com `npm i`).

### 7.5 T4-5 — compose completo em stack isolada (sem tocar a stack do dev)

A stack de dev estava no ar com dados. A prova usou um **projeto compose isolado** (`-p t4-smoke`) com override efêmero: `!override` em `ports`/`env_file` (no merge do compose estas listas **concatenam** — a porta do dev continuaria bindada), imagens próprias `t4-smoke/*:local` e env clone `.env.t4-smoke` (`.env` + `MFA_ENC_KEY` gerada por `deploy/scripts/gen-dev-env.sh`; o `.env` do usuário não foi tocado). Caminho idêntico ao job `e2e-ephemeral` do CI.

Resultado literal: `up --build -d` exit 0; **8/8 containers healthy**; `/health/live` → `{"status":"ok"}`; `/health/ready` → `{"status":"ok","postgres":"up","redis":"up","dlq":{"pending":0,"perQueue":{},"warn":false}}`; `/metrics` contém `http_requests_total`; admin `/login` → 200, `/` → 307; portal `/` → 200 (HTML com `Windows`/`macOS`), `/checkout` → 200. `down -v` do projeto isolado e `docker ps` confirmando a stack de dev intacta.

### 7.6 T4-6 — `catalog:check` vira invariantes de arquitetura (desvio registrado)

**Desvio:** o plano dizia "remover `sync-platform-catalog.mjs`/gerados; `catalog:check` vira só invariantes". O gerador foi **mantido e encolhido p/ 1 artefato** (o JSON não emite union literal em runtime — o contrato tipado continua derivado), e o `catalog:check` ganhou `checkConsumers()`, que passa a **cobrar a Trilha B**: (1) artefato legado por app re-introduzido → REPROVA; (2) app sem `"@aurum-bit/contracts": "workspace:*"` → REPROVA.

Controles negativos (saída literal):

| # | Provocação | Resultado |
|---|---|---|
| NC1 | append de linha no `products.catalog.generated.ts` | `catalog:check REPROVADO ... exit=1` (drift linha-a-linha) |
| NC2 | remover a dep do `apps/portal/package.json` | `- CONSUMER: apps/portal/package.json deve declarar "@aurum-bit/contracts": "workspace:*" (tem: ausente) ... exit=1` |
| NC3 | recriar `apps/api/.../platform-catalog.generated.ts` vazio | `- CONSUMER: apps/api/src/modules/products/platform-catalog.generated.ts é ARTEFATO LEGADO — o app deve importar @aurum-bit/contracts; apague ... exit=1` |
| — | restaurado (git checkout + re-edição) | `catalog:check OK — 5 plataformas, 2 modos, 1 artefato, consumidores via workspace:* ... exit=0` |

> **Nota de execução (não escondida):** o NC2 restaurou com `git checkout -- apps/portal/package.json`, que apagou junto a alteração **ainda não commitada** da dep; o arquivo foi re-editado (diff byte-idêntico: `index 17a4ada..5b2df01`) e o lockfile confere (importer `apps/portal` com `@aurum-bit/contracts: specifier workspace:*`). Depois disso: `catalog:check OK`.

---

## 8. Onda 6 — T5 · Cobertura ampliada (escopo D-3)

Direto em `main` (D-4, como T0–T3); base `b4ecaaf` (T4 mergeado, CI 9/9).

### 8.1 T5-1 — lint em api/workers (N-B3 fechado)

- `apps/api/package.json` e `apps/workers/package.json` ganham `"lint": "eslint src --ext .ts"` (mesmo script das libs; a flat config é **única na raiz** — o ESLint resolve subindo a árvore, então não foi criado `eslint.config.*` por app; desvio de forma registrado).
- `tools/gates-matrix.json`: removidas as 2 isenções `lint` de api/workers (a matriz cobra `lint` de todo `apps/*` e `libs/*`; "isenção cumprida reprova").
- Prova: `pnpm turbo run lint` → **12/12 exit 0**. Warnings contados e reportados (sem rebaixar regra): api **7** (diretivas `eslint-disable` "unused" de `@typescript-eslint/no-require-imports`, mantidas de propósito para quando as regras ligarem), workers **0**; admin 23 / portal 9 pré-existentes; **0 erros**.
- NC: `const __nc_t5: = 1;` injetado em `apps/api/src/main.ts` → `62:15 error Parsing error: Type expected`, **exit 1**; restaurado (diff vazio) → verde.

### 8.2 T5-2 — vitest nos dois fronts (fail-soft travado por teste)

- Scripts `"test": "vitest run --passWithNoTests"` (padrão das libs; **sem** `vitest.config.ts` — o default cobre `lib/*.spec.ts`; desvio de forma registrado).
- `apps/portal/lib/platforms.spec.ts` (**15 testes**): `normalizePlatforms` (desconhecido descartado; não-array/`null` → `[]`; só-desconhecidos → `[]`, nunca "todas"; dedup+trim+case; ordem canônica), `normalizeDeliveryMode` (desconhecido → `OFFLINE`), `operatingSystemsFrom` (vazio → `undefined`; `apple` → `iOS`; ordem canônica), `deliveryModeLabel`/`Reassurance`, `platformIconSrc` (dark só na monocromática), `joinPtBr` (0/1/2/3 itens).
- `apps/admin/lib/platforms.spec.ts` (**8 testes**): `normalizePlatformIds` (prévia = o que o backend grava), `platformLabel` nunca lança p/ id legado, `deliveryModeLabel` com fallback, `DELIVERY_MODE_OPTIONS` exaustivo, `PRODUCT_PLATFORMS` com `src` local e `darkSrc` só na monocromática.
- Prova: `pnpm turbo run test` → **12/12** (admin 8/8, portal 15/15).
- Controles negativos (semântica quebrada de propósito):
  - NC1 — `return Array.from(seen)` (perde a ordem canônica): **2 failed** (ordem canônica + `operatingSystemsFrom`);
  - NC2 — guard `PLATFORM_ID_SET` removido + retorno sem filtro (desconhecido entra): **5 failed** (descarta slug, só-desconhecidos, ordem, os 2 de OS);
  - restaurado (`git restore`, diff vazio) → **15/15** e **8/8** verdes.

### 8.3 T5-3 — `test:e2e` no CI (D8-8) e o E-1 resolvido na raiz

Diagnóstico medido (não suposição): os specs e2e usam os repositórios em memória via `.seed()`; `guards.module.ts:36` escolhe `InMemorySessionLookup` **somente** com `AUTH_REPO=memory` — sem a variável, injeta `PgSessionLookup` (sem `.seed`) → `TypeError: sessions.seed is not a function` (18 failed / 24 passed de 44).

- `apps/api/test/setup-e2e.ts`: `process.env.AUTH_REPO ??= 'memory';` (setupFiles roda antes dos imports; `??=` respeita um `AUTH_REPO` explícito).
- `.github/workflows/ci.yml` — job `unit` (que já tem services postgres+redis): passo **"e2e (AppModule real via HTTP, repos em memória)"** → `pnpm test:e2e` com o mesmo `DATABASE_URL`/`REDIS_URL` do job. YAML validado localmente (js-yaml: 6 steps no job).
- Prova local com o env do CI (sem `AUTH_REPO` no shell): **exit 0 — 7 suites / 42 passed + 2 skipped** (skip por design: `security-event.e2e.ts` exige `DATABASE_URL_AUDIT`; o health aceita 200|503). Antes: 18 failed / 24 passed.
- NC: `.expect(200)` → `.expect(418)` no `health.e2e-spec.ts` → **1 failed, exit 1**; restaurado (diff vazio) → verde.
- **E-1: fechado** — era falta do modo de teste no setup e2e, não 18 testes quebrados.

### 8.4 F-1 (achado incidental) — Argon2id x timeout de 5s no portão local

O portão documentado roda 46 tarefas juntas (2 `next build` em paralelo); o teste "sal único" de `password.spec.ts` (Argon2id real, caro de propósito) estourou o default de 5s do Jest uma vez (arquivo levou 28.31s sob contenção) e passou isolado (60 suites/664). Correção: `jest.setTimeout(30_000)` com o motivo escrito no spec — **nenhum assert/regra rebaixado**. Re-run do portão: **46/46 exit 0**, api **664/664**.

---

## 9. Handoff / estado final

- **T4 CONCLUÍDA e mergeada** (PR #1, rebase; `main @ b4ecaaf`; CI do PR 9/9 verde, incluindo `e2e-compose-efemero` em 2m28s com as 4 imagens novas). Evidência em §7.
- **T5 CONCLUÍDA** (§8): lint **12/12** (N-B3 fechado), vitest nos 2 fronts (23 testes novos + 3 NCs) e `test:e2e` no CI com **E-1 resolvido na raiz** (18 failed → 42 passed/2 skipped). CI de `main` observado após o push.
- **Única pendência aberta: D-5** (`libs/database`: deletar / ligar de verdade / manter isento — decisão do dono; isenção viva com `review_by: D-5` na matriz).
- **Regra que fica:** qualquer artefato derivado nasce com script determinístico + `--check` no CI (regra 13 do CI-VERDE, agora com exemplo vivo).

# Plano de Correção 02 — Catálogo com fonte única + gates de build reais

project: Aurum Bit
plan_id: build-gates-catalogo-2026-10-17
plan_version: 1.0.0
canonical_source: .planning/CORRECTION-PLAN-02-BUILD-GATES-2026-10-17.md
dashboard_target: nenhum nesta onda (Markdown é a fonte; HTML só se você pedir)
status: ready  # decisões D-1..D-4 resolvidas em 2026-10-17 (ver §9)
owner_role: orquestrador
created_at: 2026-10-17
baseline_repo: main @ 7bf459f (HEAD == origin/main, árvore limpa)
origin: achado do usuário (catálogo duplicado em 4 lugares / workspace não linka `@aurum-bit/contracts`) + varredura de gates executada em 2026-10-17

---

## 0. Como ler este documento

Duas trilhas, cinco ondas, cada uma com gate próprio e **controle negativo obrigatório**:

| Onda | Natureza | Risco | Gate |
|---|---|---|---|
| **Onda 1 (T0)** | Fechar os buracos de build (typecheck fantasma, `test/` não checado) | Baixo | typecheck real nas 4 apps + controle negativo por app |
| **Onda 2 (T1)** | Fonte única do catálogo + gerador + gate de drift | Baixo (nenhum arquivo de build é tocado) | `catalog:check` verde + contratos/HTTP/DB intactos |
| **Onda 3 (T2)** | Verificação adversarial (provocar a falha de propósito) | Baixo (read-only + revert) | Cada gate prova que falha quando deve falhar |
| **Onda 4 (T3)** | Conformidade, docs, grafo, push e CI | Baixo | Baseline comparado + CI `main` verde |
| **Onda 5 (T4)** | *Opcional*: unificação real via workspace + Docker pnpm/prune | **Alto** (mexe nas 4 imagens) | `docker compose build` local + `e2e-ephemeral` no CI |

**Regra de ouro:** (1) nenhum item fecha sem prova `arquivo:linha` pós-alteração; (2) **gate sem controle negativo é tratado como gate inexistente** — provar que o gate *reprova* vale mais do que vê-lo verde; (3) `commands_planned` ≠ `commands_run`: só entra como evidência o que foi executado.

---

## 1. Diagnóstico — evidência executada em 2026-10-17

### 1.1 O problema relatado: cinco cópias do mesmo catálogo

| # | Cópia | Conteúdo | Âncora |
|---|---|---|---|
| 1 | **Fonte pretendida** | `PLATFORM_IDS`, `PLATFORM_LABELS`, `DELIVERY_MODES` | `libs/contracts/src/products.ts:23,28,40` |
| 2 | API | `PRODUCT_PLATFORM_IDS`, `PRODUCT_DELIVERY_MODES` (cópia dita "defensiva") | `apps/api/src/modules/products/dto.ts:37,41` (+ comentário 26-32) |
| 3 | Admin | `PRODUCT_PLATFORM_IDS` + `PRODUCT_PLATFORMS` (id, label, `src` PNG, `darkSrc`) + `PRODUCT_DELIVERY_MODES` | `apps/admin/lib/platforms.ts:23-53,77-96` |
| 4 | Portal | `PLATFORM_IDS`, `PLATFORM_LABELS`, `PLATFORM_SHORT_LABELS`, `DARK_VARIANT`, `OPERATING_SYSTEM_NAMES` | `apps/portal/lib/platforms.ts:33-63,65-66,133-143` |
| 5 | Python (não importa TS) | `PLATFORMS` (id ↔ label ↔ arquivo de origem) + `MONOCHROME` | `tools/build-tag-icons.py:45-51,54` |

Drift já latente hoje: a mesma verdade (`apple` é monocromático ⇒ tem variante dark) está escrita **três vezes** e de três formas diferentes — `MONOCHROME = {"apple"}` (Python:54), `DARK_VARIANT = { apple: true }` (portal:65), `darkSrc` inline (admin:52). Um id novo em `libs/contracts` **não quebra nada** em nenhuma das 4 cópias: é fail-open por omissão.

### 1.2 As três causas raiz

| ID | Causa | Evidência |
|---|---|---|
| **C1** | Nenhum app declara `@aurum-bit/contracts`; não existe `node_modules/@aurum-bit` em `apps/api`, `apps/admin`, `apps/portal`, `apps/workers` nem na raiz ⇒ `import "@aurum-bit/contracts"` **não resolve**. O pnpm só cria o link para dependência declarada. | `pnpm-lock.yaml:302` lista `libs/contracts:` como importer, mas nenhum `apps/*/package.json` o referencia |
| **C2** | **As 4 imagens Docker instalam dependências dentro da pasta do app, sem workspace.** `api`/`workers` usam `npm install`; `admin`/`portal` usam `pnpm i --frozen-lockfile` em `/app` com **apenas** a `package.json` do app. Não há `pnpm-workspace.yaml` nem `libs/` no contexto copiado. | `apps/api/Dockerfile:5-8`, `apps/workers/Dockerfile:5-8`, `apps/admin/Dockerfile:2-9`, `apps/portal/Dockerfile:2-9` |
| **C3** | `nest build` compila **só `src/`** (`test/` é excluído) e nada mais typechecka `test/` ⇒ qualquer import de `libs/contracts` em `test/` não passa por checagem nenhuma. | `apps/api/tsconfig.build.json:3` |

### 1.3 Os quatro buracos de gate ("nenhum outro problema de Build")

| ID | Achado | Evidência executada |
|---|---|---|
| **N-B1** | `turbo run typecheck` **anuncia 12 workspaces e checa 8**. As 4 apps aparecem na lista com comando inexistente — falso verde no CI. | `npx turbo run typecheck --dry=json` → `@aurum-bit/api`, `@aurum-bit/workers`, `@aurum/admin`, `@aurum/portal` com `cmd: "<NONEXISTENT>"`. CI: `.github/workflows/ci.yml:46` |
| **N-B2** | `apps/api` não typechecka `test/`: o comando canônico **falha hoje** com `TS6059` ×6. O erro real (contrato importado fora do `rootDir`) está escondido porque ninguém roda isso. | `npx tsc --noEmit -p tsconfig.json` em `apps/api` → `exit=2`; `test/access.check.e2e-spec.ts(4,43)`, `test/helpers/guarded-test.controller.ts(3,...)`; `rootDir` = `apps/api` (`apps/api/tsconfig.json:6`) |
| **N-B3** | `turbo run lint` cobre admin, portal e as 8 libs — **`apps/api` e `apps/workers` não têm script `lint`**. | `apps/api/package.json:7-14`, `apps/workers/package.json:7-12` |
| **N-B4** | Pendências do plano anterior nunca executadas: **D8-7** (`apps/api` ganhar `typecheck`) e **D8-8** (CI rodar `test:e2e`). O registro de execução só comprova `libs/*` 7/7. | `.planning/CORRECTION-PLAN-2026-10-17.md:155-156`; `.planning/CORRECTION-EXECUTION-2026-10-17.md:12` |

### 1.4 Por que a correção "óbvia" (`workspace:*` + import) **quebra o build hoje**

```
apps/api/package.json  +=  "@aurum-bit/contracts": "workspace:*"
        │
        ├─ pnpm local .......... OK (workspace existe na raiz)
        │
        └─ imagem Docker ........ FALHA
             apps/api/Dockerfile:7-8   COPY apps/api/package*.json ./   → só a package.json do app
             apps/api/Dockerfile:8     npm install                       → "workspace:*" não é spec válida p/ npm
             admin/portal             pnpm i --frozen-lockfile em /app   → sem pnpm-workspace.yaml, mesma falha
                                        │
                                        └─ CI `e2e-ephemeral` roda `docker compose up --build -d`
                                           (.github/workflows/ci.yml:149) → o CI quebraria no PR da "correção"
```

Conclusão que orienta a estratégia: **o problema do catálogo e o problema do Docker são o mesmo problema adiado**. Resolver C1 sem C2 troca uma divergência silenciosa por um build vermelho. Por isso a Onda 5 (T4) existe, é separada e é decisão sua.

---

## 2. Objetivo, escopo e critérios de aceite

**Objetivo:** o catálogo de plataformas passa a ter uma fonte única verificável, e os gates de build passam a cobrir **todas** as apps — de forma que (a) divergência de catálogo seja impossível de entrar sem CI vermelho e (b) uma app sem typecheck real seja impossível de entrar sem CI vermelho.

**Fora de escopo (não muda neste plano):** contrato HTTP (`docs/openapi.yaml`), schema Prisma, slugs de plataforma (`products.platforms TEXT[]`), comportamento fail-closed da API, fail-soft do portal, pipeline de billing/RBAC/rate-limit (planos anteriores).

| # | Critério de aceite | Comando | Esperado |
|---|---|---|---|
| A1 | Nenhuma tarefa de gate é fantasma | `npx turbo run typecheck --dry=json` | **0** ocorrências de `<NONEXISTENT>`; 12/12 com comando real |
| A2 | `apps/api` typechecka `src/` **e** `test/` | `pnpm --filter @aurum-bit/api typecheck` | `exit 0` |
| A3 | Cobertura de gates é conferida por script | `pnpm gates:check` | `exit 0` + matriz impressa |
| A4 | Cópia editada à mão reprova | `pnpm catalog:check` com 1 id alterado numa cópia | `exit 1` + arquivo:linha da divergência |
| A5 | Gerados são determinísticos | `pnpm catalog:sync` 2× | `git status --porcelain` inalterado na 2ª |
| A6 | Contrato intacto | `pnpm --filter @aurum-bit/api test` | 60 suites / 664 testes ✅ |
| A7 | Build intacto | `pnpm turbo run build` | 12/12 ✅ |
| A8 | Prisma intacto | `npx prisma@6.8.0 validate --schema=prisma/products/schema.prisma` | schema válido |
| A9 | Nada de arquivo sujo pelos gates | `git status --porcelain` após rodar todos | vazio |
| A10 | CI verde no `main` | GitHub Actions após push | `lint → typecheck → unit → build → prisma → e2e-ephemeral → trivy` verdes |

---

## 3. Estratégia

**Trilha A — obrigatória (Ondas 1-4).** Fonte única + artefatos **gerados e commitados** + gate de drift, e gates de tipo reais. Não toca Docker, não toca Next config, não toca contrato: por construção não pode quebrar imagem, standalone, nem runtime. É o que resolve o problema relatado **de vez** no nível de divergência.

**Trilha B — opcional (Onda 5).** Unificação arquitetural de verdade: `@aurum-bit/contracts` como dependência de workspace + migração das 4 imagens para pnpm + `turbo prune --docker` (o `TODO(T1)` já registrado em `apps/api/Dockerfile:3`). As cópias geradas desaparecem. Só depois de A verde, em PR próprio, com prova de `docker compose build`.

**Por que os gerados precisam ser commitados (e não gerados no build):** as imagens Docker copiam **apenas** `apps/<app>` (C2). Qualquer artefato consumido pelo app precisa existir dentro da pasta do app e estar no git. Gerar em tempo de build quebraria a imagem — o oposto do objetivo.

---

## 4. Tarefas

### Gate de pré-implementação (bloqueia `ready`)

- Problema/goal por task: abaixo, 1 linha cada.
- Superfície e pontos de entrada: colunas `candidate_files` abaixo (escrita restrita a elas).
- Contratos/APIs afetados: **nenhum** contrato HTTP/DB muda (A6/A8 provam).
- Áreas proibidas: `prisma/`, `deploy/` (só na Onda 5), `.env*`, qualquer coisa em produção/VPS.
- Mocks/placeholders: **nenhum** (NO-MOCKS). Não há alarme de mock nesta correção.
- Acceptance/negative tests: coluna `controle negativo` de cada task — obrigatória.

---

### Onda 1 — T0 · Gates de build reais

#### T0-1 — `gates:check`: cobertura de tarefas por workspace
```
owner_role:        infra
agent_sequence:    [implementador] → [verificador adversarial]
candidate_files:   tools/check-gates.mjs (novo), tools/gates-matrix.json (novo), package.json (raiz)
mudança:           script node (sem dependências) que lê pnpm-workspace.yaml (apps/*, libs/*),
                   exige por pacote as tarefas da matriz (build+typecheck: todos; lint: todos;
                   test: api/workers/libs) e confirma que cada tarefa existe em turbo.json#tasks.
                   Exceções só via matriz com {motivo, revisar_em}. Sai 1 listando pacote#tarefa faltante.
verificação:       pnpm gates:check → exit 0 + matriz impressa (12 pacotes × tarefas)
controle negativo: remover "typecheck" de apps/portal/package.json → gates:check DEVE falhar citando
                   @aurum/portal#typecheck → restaurar → verde
evidence:          saída literal dos 2 comandos + git status limpo
rollback:          git checkout -- tools/ package.json
depends_on:        —
status:            ready
```

#### T0-2 — `typecheck` real em `apps/api` (fecha N-B2 + D8-7)
```
owner_role:        infra-backend
candidate_files:   apps/api/package.json, apps/api/tsconfig.typecheck.json (novo)
mudança:           novo tsconfig.typecheck.json estendendo tsconfig.json com { rootDir: "../..",
                   noEmit: true, incremental: false } (o rootDir acima dos dois pacotes é o que mata o
                   TS6059 sem mexer em tsconfig.build.json — logo o layout de dist/ do build não muda);
                   script "typecheck": "tsc --noEmit -p tsconfig.typecheck.json".
verificação:       pnpm --filter @aurum-bit/api typecheck → exit 0
controle negativo: (a) injetar `const _x: number = "s"` em src/main.ts → DEVE falhar;
                   (b) injetar o mesmo em test/access.check.e2e-spec.ts → DEVE falhar (é exatamente o
                   caso que passa desapercebido hoje); reverter os dois.
evidence:          exit 0 + as 2 falhas provocadas com o trecho de erro
rollback:          git checkout -- apps/api/package.json apps/api/tsconfig.typecheck.json
depends_on:        —
risco:             pode revelar erros reais pré-existentes em test/ (desconhecido). Timebox: 1 lote;
                   se surgir erro de negócio, vira item próprio e o relatório não esconde a contagem.
status:            ready
```

#### T0-3 — `typecheck` real em `apps/workers`
```
owner_role:        infra
candidate_files:   apps/workers/package.json
mudança:           "typecheck": "tsc --noEmit -p tsconfig.json" (o build já é `tsc -p tsconfig.json`,
                   então o gate é verde por construção e passa a existir no turbo).
verificação:       pnpm --filter @aurum-bit/workers typecheck → exit 0
controle negativo: erro de tipo em src/main.ts → DEVE falhar → reverter
rollback:          git checkout -- apps/workers/package.json
status:            ready
```

#### T0-4 — `typecheck` real em `apps/admin` e `apps/portal`
```
owner_role:        infra-frontend
candidate_files:   apps/admin/package.json, apps/portal/package.json
mudança:           "typecheck": "tsc --noEmit -p tsconfig.json" nas duas (os tsconfig já têm noEmit,
                   strict, next-env.d.ts commitado; `next build` continua sendo o gate de produção).
verificação:       pnpm --filter @aurum/admin typecheck && pnpm --filter @aurum/portal typecheck → exit 0
controle negativo: erro de tipo em apps/admin/lib/platforms.ts e apps/portal/lib/platforms.ts →
                   ambos DEVEM falhar → reverter
evidence:          exit 0 + falhas provocadas + git status limpo (sem *.tsbuildinfo solto)
rollback:          git checkout -- apps/admin/package.json apps/portal/package.json
status:            ready
```

#### T0-5 — CI passa a cobrar os gates reais
```
owner_role:        infra
candidate_files:   .github/workflows/ci.yml
mudança:           no job `lint` (primeiro, barato): step `pnpm gates:check`; no job `typecheck`:
                   nada a mudar (passa a ser real sozinho). `turbo run build/test` inalterados.
verificação:       pnpm gates:check local + `turbo run typecheck --dry=json` sem <NONEXISTENT>
evidence:          dry-run literal (12/12 com comando) + CI verde após push (T3-4)
rollback:          git checkout -- .github/workflows/ci.yml
depends_on:        T0-1..T0-4
status:            ready
```

#### T0-6 — Docs de CI atualizados
```
owner_role:        infra
candidate_files:   docs/CI-VERDE.md, .planning/STATE.md
mudança:           registrar os gates novos (typecheck 12/12, gates:check, catalog:check) e o que cada
                   um reprova. STATE.md recebe o resumo da onda.
depends_on:        T0-5
status:            ready
```

---

### Onda 2 — T1 · Fonte única + gerador + gate de drift

#### T1-1 — Catálogo como dado no `libs/contracts`
```
owner_role:        infra-contratos
candidate_files:   libs/contracts/src/products.catalog.json (novo), libs/contracts/src/products.ts
mudança:           JSON único com { platforms: [{ id, label, shortLabel, monochrome, assetFile }],
                   deliveryModes: ["OFFLINE","HYBRID"] }. products.ts passa a DERIVAR
                   PLATFORM_IDS / PLATFORM_ID_SCHEMA / PLATFORM_LABELS / DELIVERY_MODES /
                   DELIVERY_MODE_SCHEMA do JSON — nomes e tipos exportados IDÊNTICOS (zero call-site).
                   Ganho imediato: shortLabel e monochrome deixam de ser cópias do portal/python.
verificação:       pnpm --filter @aurum-bit/contracts typecheck && build && test → verde;
                   node -e "const p=require('./libs/contracts/dist/products.js');console.log(p.PLATFORM_IDS,p.DELIVERY_MODES)"
controle negativo: acrescentar id "beos" no JSON → typecheck do portal DEVE acusar chave faltando em
                   OPERATING_SYSTEM_NAMES (exaustividade por tipo) → reverter
decisão embutida:  se o emit do JSON em dist/ (resolveJsonModule + declaration) criar atrito, inverter
                   para TS-fonte + JSON-gerado e registrar em §8 (D-2)
rollback:          git checkout -- libs/contracts/src/
status:            ready
```

#### T1-2 — Gerador determinístico + gate de drift + checagem de assets
```
owner_role:        infra
candidate_files:   tools/sync-platform-catalog.mjs (novo), package.json (raiz)
mudança:           `pnpm catalog:sync` gera e `pnpm catalog:check` confere (--check):
                   (a) apps/api/src/modules/products/platform-catalog.generated.ts
                   (b) apps/admin/lib/platforms.generated.ts   (id,label,src,darkSrc)
                   (c) apps/portal/lib/platforms.generated.ts  (ids,labels,shortLabels,darkVariant)
                   (d) valida que cada id tem PNG em apps/{admin,portal}/public/tags/<id>.png
                       (+ <id>-dark.png quando monochrome) e o assetFile de origem em ASSETS/tags/
                   Cabeçalho "GERADO POR tools/sync-platform-catalog.mjs — NÃO EDITAR", sem timestamp
                   (determinismo), ordenação estável. `--check` compara byte a byte.
verificação:       pnpm catalog:sync → catalog:check (exit 0); rodar sync 2× → git status inalterado
controle negativo: editar 1 label à mão num gerado → catalog:check DEVE falhar apontando arquivo;
                   renomear um PNG de /tags → catalog:check DEVE falhar apontando o asset → reverter
rollback:          git checkout -- tools/ package.json apps/*/…generated.ts
depends_on:        T1-1
status:            ready
```

#### T1-3 — API consome o gerado (fim da cópia de `dto.ts`)
```
owner_role:        backend-produtos
candidate_files:   apps/api/src/modules/products/dto.ts
mudança:           dto.ts importa PRODUCT_PLATFORM_IDS/PRODUCT_DELIVERY_MODES do gerado e atualiza o
                   comentário (26-32) que hoje documenta a cópia manual. Validações e mensagens intactas.
verificação:       pnpm --filter @aurum-bit/api typecheck && test → 60/664 ✅
controle negativo: POST /v1/products com platforms:["plan9"] → 400 com a mesma mensagem de hoje
rollback:          git checkout -- apps/api/src/modules/products/
depends_on:        T1-2
status:            ready
```

#### T1-4 — Admin consome o gerado (id/label/src/darkSrc)
```
owner_role:        frontend-bff
candidate_files:   apps/admin/lib/platforms.ts
mudança:           PRODUCT_PLATFORM_IDS e PRODUCT_PLATFORMS vêm do gerado; helpers
                   (normalizePlatformIds, platformLabel, deliveryModeLabel) permanecem — API pública igual.
verificação:       pnpm --filter @aurum/admin typecheck && build → verde
controle negativo: platformLabel("desconhecida") → devolve o próprio id (comportamento atual preservado)
depends_on:        T1-2
status:            ready
```

#### T1-5 — Portal consome o gerado (ids/labels/shortLabels/darkVariant)
```
owner_role:        frontend-landpage
candidate_files:   apps/portal/lib/platforms.ts
mudança:           PLATFORM_IDS/PLATFORM_LABELS/PLATFORM_SHORT_LABELS/DARK_VARIANT vêm do gerado.
                   normalizePlatforms segue FAIL-SOFT (desconhecido → fora; não-array → []).
                   OPERATING_SYSTEM_NAMES e copy de marketing ficam no portal (apresentação), mas
                   passam a ser Record<PlatformId gerado> ⇒ id novo sem copy quebra o typecheck.
verificação:       pnpm --filter @aurum/portal typecheck && build → verde
controle negativo: normalizePlatforms(["windows","amiga",null]) → ["windows"]; normalizePlatforms("x") → []
depends_on:        T1-2
status:            ready
```

#### T1-6 — Python lê o catálogo (fim da 5ª cópia)
```
owner_role:        tooling-assets
candidate_files:   tools/build-tag-icons.py
mudança:           PLATFORMS/MONOCHROME saem do literal e passam a vir de
                   libs/contracts/src/products.catalog.json (json.load). Falha explícita e legível se o
                   JSON não existir ou um id não tiver asset — hoje o script só falharia no meio do loop.
verificação:       python tools/build-tag-icons.py → 12 PNGs inalterados (git status limpo em public/tags)
controle negativo: apontar assetFile para arquivo inexistente no JSON → script DEVE sair com erro claro
depends_on:        T1-1
status:            ready
```

#### T1-7 — Invariantes testados + docs
```
owner_role:        infra-contratos
candidate_files:   libs/contracts/src/products.catalog.spec.ts (novo), docs/design-system/DS.md,
                   docs/ARCHITECTURE.md, docs/CI-VERDE.md
mudança:           vitest no contracts: ids únicos, minúsculos, label/shortLabel não vazios, todo id com
                   assetFile, deliveryModes sem duplicata, PLATFORM_LABELS cobrindo todos os ids.
                   Docs: DS.md (nota de geração + onde editar), ARCHITECTURE.md (contratos como fonte única
                   e o motivo de existirem gerados — C2/Docker), CI-VERDE.md (catalog:check no CI).
verificação:       pnpm --filter @aurum-bit/contracts test → verde; pnpm catalog:check → verde
controle negativo: remover um shortLabel no JSON → teste DEVE falhar
status:            ready
```

---

### Onda 3 — T2 · Verificação adversarial (o gate que prova que reprova)

#### T2-1 — Drift do catálogo
```
owner_role:        verificador (read-only + revert)
procedimento:      (a) alterar 1 label num gerado → catalog:check falha; (b) alterar o JSON e NÃO rodar
                   sync → check falha; (c) rodar sync → check verde; (d) sync 2× → determinístico;
                   (e) renomear PNG → falha; (f) restaurar tudo.
evidence:          as 5 saídas literais + git status limpo no fim
regra:             qualquer item sem falha provocada = gate não conta (volta para T1-2)
```

#### T2-2 — Typecheck não é vazio (controle por app)
```
owner_role:        verificador
procedimento:      injetar erro de tipo, 1 por app, em arquivo que hoje NÃO é checado
                   (api: test/; workers: src/main.ts; admin: lib/platforms.ts; portal: lib/platforms.ts),
                   rodar `pnpm turbo run typecheck` e provar 4 falhas; reverter; provar verde.
evidence:          dry-run sem <NONEXISTENT> + 4 falhas + verde final
```

#### T2-3 — Semântica preservada (fail-closed / fail-soft / `[]` = nenhuma)
```
owner_role:        verificador
procedimento:      (a) API: plataforma inválida → 400; (b) portal: desconhecido → fora da lista;
                   (c) admin: label de id desconhecido → id; (d) `[]` continua "nenhuma declarada",
                   nunca "todas"; (e) os 5 slugs são os mesmos de antes (comparação com
                   `git show HEAD~N:…` para provar que nenhum slug mudou).
evidence:          diff dos slugs antigos × novos = vazio
```

#### T2-4 — Não-regressão completa
```
owner_role:        verificador
comandos:          turbo run lint|typecheck|build --continue; api test; workers test; contracts test;
                   prisma validate; (docker compose config -q)
evidence:          tabela antes/depois (§7) sem regressão
```

---

### Onda 4 — T3 · Conformidade e entrega

| ID | Ação | Gate |
|---|---|---|
| **T3-1** | Baseline final completo (§7) com números | Nenhum item piora |
| **T3-2** | `.planning/CORRECTION-EXECUTION-02-2026-10-17.md` no formato do precedente (ID, claim, arquivo:linha, antes/depois, veredito, prova, teste) | Item sem prova = não conta |
| **T3-3** | `.planning/STATE.md` + rebuild do grafo (`cd docs/knowledge-v2 && npm run rebuild`) | Nós/arestas ≥ 934/1187 |
| **T3-4** | Commits atômicos por task (`tipo(escopo): …`) + push `main` + observação do CI | A10 |

---

### Onda 5 — T4 · *Opcional* — Unificação real (decisão D-1)

| ID | Ação | Gate |
|---|---|---|
| **T4-1** | Ler `docs/` do turbo **2.11.7** instalado sobre `prune --docker` (regra do AGENTS.md) | Nota de decisão registrada |
| **T4-2** | `"@aurum-bit/contracts": "workspace:*"` em api/admin/portal (+workers se aplicável) e imports reais; gerados removidos | typecheck/build 12/12 |
| **T4-3** | `outputFileTracingRoot` nas duas Next (monorepo) + conferir standalone | `next build` gera `.next/standalone` com o pacote traçado |
| **T4-4** | 4 Dockerfiles → pnpm + `turbo prune --docker` (mata `TODO(T1)`) | `docker compose -f deploy/docker-compose.yml build` local |
| **T4-5** | Smoke das 4 imagens (`/health/ready`, admin, portal) | `docker compose up` + smoke do CI (`ci.yml:149-185`) |
| **T4-6** | Remover `sync-platform-catalog.mjs`/gerados; `catalog:check` vira só invariantes | `catalog:check` verde; diff final revisado |

**Rollback da Onda 5:** revert do commit — não há migração de dados nem mudança de contrato; as imagens são reconstruídas da fonte.

---

### Onda 6 — T5 · Cobertura ampliada (escopo decidido em D-3)

| ID | Ação | candidate_files | Gate |
|---|---|---|---|
| **T5-1** | `lint` em `apps/api` e `apps/workers` (flat config espelhando o das libs; **N-B3**) | `apps/api/eslint.config.*` (novo), `apps/workers/eslint.config.*` (novo), `apps/*/package.json` | `pnpm turbo run lint` cobre 12/12; erros corrigidos, warnings contados e reportados (proibido rebaixar regra para "fechar") |
| **T5-2** | Testes em `apps/admin` e `apps/portal` (vitest, ambiente node, funções puras: `lib/platforms.ts`, mappers) | `apps/{admin,portal}/vitest.config.ts` (novo), `apps/{admin,portal}/**/*.spec.ts` (novos), `package.json` | `pnpm turbo run test` cobre 12/12; testes falham se a semântica fail-soft/fail-closed mudar |
| **T5-3** | **D8-8**: `test:e2e` no CI (job `unit` já tem Postgres/Redis) | `.github/workflows/ci.yml`, `apps/api/test/*` (só se houver erro real) | `pnpm test:e2e` verde local **e** no CI |

Controle negativo obrigatório em cada item do T5: (T5-1) erro de lint injetado reprova; (T5-2) mudar a semântica do portal (`unknown` → dentro da lista) reprova o teste; (T5-3) quebrar um spec de propósito reprova o job.

---

## 5. Fluxo agêntico

| Papel | Quem | Pode escrever? | Entrega |
|---|---|---|---|
| **orquestrador** | eu | sim (plano, commits) | ondas, decisões, push |
| **implementador por lane** | subagente | só `candidate_files` da task | diff + comandos executados |
| **verificador adversarial** | subagente | não (só revert de provocação) | veredito CONFIRMADO/PARCIAL/REFUTADO com prova literal |
| **conformidade** | subagente | só docs de estado | tabela antes/depois |

**Contratos de handoff (sequencial por padrão):**
- *Entrada do implementador:* task block + baseline da §7 + `candidate_files`.
- *Saída do implementador:* diff, comandos **executados** (não planejados), saída literal, `arquivo:linha` final, `git status` limpo.
- *Entrada do verificador:* diff + saída do implementador.
- *Saída do verificador:* veredito + prova literal + resultado do controle negativo.
- *Stop conditions:* (1) tocar arquivo fora de `candidate_files`; (2) precisar mudar contrato HTTP/DB; (3) qualquer gate ficar vermelho por motivo não relacionado à task; (4) `docker`/rede indisponível quando a task exige.
- *max_review_loops:* 2 por task. **Escalonamento:** esgotado o loop ou bloqueio local → para a lane, devolve ao orquestrador com a evidência bruta; **não** contorna o gate para "fechar".
- **Paralelismo:** T0-2/T0-3/T0-4 são independentes (arquivos disjuntos) e podem rodar em paralelo; T1-3/T1-4/T1-5 também (depois de T1-2). Todo o resto é sequencial.

---

## 6. Governança de execução

- **NO-FICTION:** nada de "feito" sem saída literal. `commands_planned` ≠ `commands_run`.
- **NO-MOCKS/NO-PLACEHOLDERS:** nenhum mock entra nesta correção; não há alarme de mock.
- **verification-first:** teste planejado pelo implementador, revisado pelo verificador, executado com prova.
- **code-first:** task de código não fecha com progresso só de documentação.
- **Proibições:** deploy, VPS, `.env`/segredos, `prisma migrate`, tocar produção, `git push --force`, reescrever histórico.
- **Commits:** um por task, `tipo(escopo): assunto` em pt-BR (padrão do repo). Push ao fim de cada onda; CI observado antes de seguir para a onda seguinte.
- **Regra do grafo (AGENTS.md):** consultar `docs/knowledge-v2` no início de cada lane; rebuild ao fim da onda.

---

## 7. Estratégia de verificação e baseline

### Números de hoje (medidos em 2026-10-17, `main @ 7bf459f`)

| Comando | Hoje | Depois de T0/T1 |
|---|---|---|
| `pnpm turbo run typecheck` | 8 reais ✅ + **4 `<NONEXISTENT>`** | **12 reais** ✅ |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | **exit 2 — TS6059 ×6** | substituído pelo `tsconfig.typecheck.json` ✅ |
| `pnpm turbo run lint` | admin+portal+8 libs; 0 erros / 23 warnings (admin) | inalterado + `gates:check` |
| `pnpm turbo run build` | 12/12 ✅ | inalterado |
| `pnpm --filter @aurum-bit/api test` | 60 suites / 664 testes ✅ | inalterado |
| `pnpm --filter @aurum-bit/workers test` | 2 specs (ts-node) ✅ | inalterado |
| `pnpm --filter @aurum-bit/contracts test` | `passWithNoTests` | **com testes do catálogo** |
| `prisma validate` (products) | schema válido ✅ / `migrate status` sem drift | inalterado |
| `docker compose -f deploy/docker-compose.yml config -q` | ✅ | inalterado (muda só na Onda 5) |
| Grafo `docs/knowledge-v2` | 934 nós / 1187 arestas | ≥ esse valor |

### Regras de reprovação automática

- Gate verde **sem** controle negativo executado ⇒ gate não conta (item volta).
- `api test` < 664 ou `build` < 12/12 ou lint com erro novo ⇒ **a onda inteira volta**, não só o item.
- Divergência de slug de plataforma (qualquer um dos 5) ⇒ PARADO: exigiria migration de dados, fora de escopo.

---

## 8. Alarmes, riscos e mitigações

| ID | Risco | Mitigação | Bloqueia? |
|---|---|---|---|
| **R-1** | `apps/api` typecheck (T0-2) pode revelar erros reais em `test/` (desconhecido hoje) | timebox de 1 lote; erros de negócio viram item próprio, contagem reportada (nunca escondida) | não |
| **R-2** | Emit do JSON em `libs/contracts` (`resolveJsonModule` + `declaration`) | decisão D-2 com plano B (TS-fonte + JSON gerado) já definido | não |
| **R-3** | Turbo **cache** pode esconder drift (inputs de fora do pacote) | `catalog:check` roda como step de CI, **fora** do turbo | não |
| **R-4** | Gerados sem determinismo (timestamp/ordem) ⇒ gate eternamente vermelho | proibido timestamp; ordenação estável; A5 prova | não |
| **R-5** | Onda 5 mexe em 4 imagens; iteração de Docker é lenta e o CI gasta ~min por build | Onda 5 só depois de A verde; prova local primeiro; PR isolado | sim (para T4) |
| **R-6** | `*.tsbuildinfo`/artefatos soltos sujando a árvore | `*.tsbuildinfo` já está no `.gitignore:5`; A9 exige `git status` limpo | não |
| **R-7** | "Verde porque não olhou": alguém adiciona app nova (`apps/*`) fora dos gates | `gates:check` exige a matriz (T0-1) | não |

**Alarmes ativos nesta correção:** nenhum. **Mocks/placeholders:** nenhum.

---

## 9. Decisões — RESOLVIDAS em 2026-10-17

**D-1 — Trilha B:** decidido **fazer a Trilha A primeiro e, com tudo verde, iniciar automaticamente a Trilha B** (T4 assume status `ready`, disparada ao fim de T3-4 com CI verde — não é mais "opcional"; o rollback dela segue sendo revert de commit, sem migração de dados).

**D-2 — Formato da fonte única:** **JSON em `libs/contracts/src` + TS derivado** (json.load direto no Python, sem build). Plano B do R-2 permanece registrado caso o emit do JSON em `dist/` crie atrito.

**D-3 — Escopo extra:** decidido **incluir tudo** — (i) `lint` em `apps/api`/`apps/workers`, (ii) testes em `apps/admin`/`apps/portal`, (iii) **D8-8** (`test:e2e` no CI). Isso vira a **Onda 6 — T5** abaixo, executada depois de T3 (para não misturar uma correção de risco baixo com a introdução de infra de teste nova).

**D-4 — Push:** **commits atômicos por task, push ao fim de cada onda** (CI observado antes da onda seguinte).

---

## 10. Ordem de execução

```
T0-1 ─┬─ T0-2 ─┐
      ├─ T0-3 ─┼─ T0-5 → T0-6 ─┐
      └─ T0-4 ─┘               │
T1-1 → T1-2 ─┬─ T1-3 ─────────┤
             ├─ T1-4 ─────────┼─ T2-1..T2-4 → T3-1..T3-4 (push + CI)
             ├─ T1-5 ─────────┤
             └─ T1-6, T1-7 ───┘
                                    └── D-1(a) → T4-1..T4-6 (PR próprio)
```

---

## 11. Wiki / knowledge sync

**Ler antes (por lane):** `docs/knowledge-v2` (`node query.js "<tema>" --limit 8`), `.planning/STATE.md`, `docs/ARCHITECTURE.md`, `docs/CI-VERDE.md`, `docs/design-system/DS.md`.

**Escrever depois:** `.planning/STATE.md`, este plano + `CORRECTION-EXECUTION-02-…`, `docs/CI-VERDE.md`, `docs/design-system/DS.md`, `docs/ARCHITECTURE.md`; rebuild do grafo (`cd docs/knowledge-v2 && npm run rebuild`).

**Não gravar:** segredos, dados pessoais, conteúdo de `.env`.

---

## 12. Fora de escopo nesta correção

- Renomear/adicionar slug de plataforma (exigiria migration em `products.platforms`).
- RBAC, pipeline de billing/outbox, rate-limit, shutdown, pool de sessão (planos anteriores, com decisões próprias).
- Redesign/landpage, Fases 9-10 (app_<slug>, sync).
- Qualquer coisa em produção, VPS, DNS ou imagens publicadas.

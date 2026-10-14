# knowledge-v2 — grafo DEV-ONLY (não contamina prod)

Suporte a agentes/modelos com conhecimento ponta a ponta do repo. **Nada aqui
é importado por `apps/`, `libs/`, `prisma/` ou `deploy/`.** Sem container,
sem migração, sem env novo, sem CI.

## Garantias anti-contaminação

- Fora do `pnpm-workspace.yaml` (`apps/*`, `libs/*`) → `turbo` ignora.
- Sem dependência no `package.json` raiz. `kuzu` é `optionalDependency`
  **desta pasta** e o código faz `try require` com fallback JSON.
- `ingest.js` só **lê** o repo e só **escreve** em `docs/knowledge-v2/data/`
  (gitignored). Verifique: `git status --porcelain` mostra só `docs/knowledge-v2/`.
- `data/` é descartável: apague e rode `node ingest.js` de novo.

## Uso (zero install)

```bash
cd docs/knowledge-v2
node ingest.js                    # gera data/graph.json + data/index.json
node query.js "webhook asaas"     # top nós + vizinhança 1-hop + arestas
node query.js "finance routes" --json --limit 5   # saída p/ agente
npm run rebuild                   # ingest + kuzu (rodar ao TERMINAR qualquer tarefa)
```

## Opt-in Kuzu (embarcado, ainda dev-only)

```bash
cd docs/knowledge-v2 && npm install   # instala kuzu SÓ nesta pasta
npm run ingest:kuzu                   # gera data/graph.kuzu a partir do JSON
```

Se `kuzu` não estiver instalado, `ingest-kuzu.js` sai com código 0 e o modo
JSON continua valendo — nenhum erro vaza p/ build/test/prod.

## Fontes (todas read-only)

1. `../knowledge/graph.json` (seed manual curado — preservado com flag `seed`)
2. `apps/api/src/**/*.controller.ts` (`@Controller` + verbos → nós `route:*`) + `**/*.service.ts` (→ `svc:*`)
3. `prisma/*/schema.prisma` (`model X` → nós `db:<dominio>.<model>`)
4. `apps/workers/src/**/*.ts` (strings `*.v1` / filas BullMQ → nós `ev:` / `q:`)
5. `apps/portal/app/**/page.tsx` (→ `ui-page:portal:*`, `/` = landpage) + `app/api/**/route.ts` (→ `bff:portal:*`)
6. `apps/admin/app/**/page.tsx` (→ `ui-page:admin:*`) + `app/api/**/route.ts` (→ `bff:admin:*`)
7. `apps/portal/components/sections/*.tsx` (→ `ui-section:*` com sinônimos de landpage) + `apps/portal/lib/*` (→ `fe-lib:*`)
8. `apps/{portal,admin}/{components,lib,hooks,stores}` + `middleware.ts` (→ `file:*`)
9. `libs/*` (→ `lib:*` + `file:*`)
10. `deploy/docker-compose*.yml` (services → `infra:*`) + `deploy/scripts/*.sh` (→ `infra-script:*`)
11. `docs/*.md` (→ `doc:*` com título H1 real)

## Quando atualizar

- Após mudar controllers, models ou eventos: `node ingest.js`.
- Após mudar decisão arquitetural: edite `../knowledge/graph.json` (seed) e rode `ingest.js`.

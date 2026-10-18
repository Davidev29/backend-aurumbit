# Diretriz CI-Verde — norma permanente deste repositório

> Toda implementação deve nascer prevendo CI verde, sem quebrar nada.
> Tudo verde no local E no remoto antes de considerar pronto.
> Nasceu dos incidentes reais da Fase 9 (documentados em `.planning/PHASE-9-REPORT.md`).

## 1. Portão local obrigatório (antes de qualquer commit)

```bash
bash deploy/scripts/prisma-validate.sh          # 9/9 schemas
pnpm gates:check                                # cobertura de gates por workspace (turbo não pode ser "fantasma")
pnpm catalog:check                              # catálogo de plataformas: drift do artefato + workspace:* + ícone órfão
pnpm turbo run lint typecheck test build --continue   # 12/12 workspaces, inclui as 4 apps
pnpm test:e2e                                   # api: AppModule real via HTTP — 42 testes (repos em memória)
bash -n deploy/scripts/*.sh                     # sintaxe de todos os scripts
"$BIN/trivy.exe" fs --severity HIGH,CRITICAL --exit-code 1 --no-progress .   # mesmo binário do CI
gitleaks detect --redact --exit-code=2 --no-git # mesma versão do CI (8.24.3)
```

Nenhum push com portão local vermelho. Exceção só para gates que exigem
Docker/rede (e2e-compose, clone-ready) — esses são validados no primeiro CI e
corrigidos em follow-up imediato, nunca "depois". O `test:e2e` (HTTP, sem Docker)
roda local **e** no CI — não é exceção.

## 2. Regras que não se violam

1. **Tags externas se verificam, não se adivinham.** Imagem Docker (`edoburu/pgbouncer:v1.24.0-p1`)
   e Action (`trivy-action@v0.36.0`) — conferir existência no registry antes de
   commitar. Tag removida quebra o CI sem tocar no nosso código.
2. **Uma fonte de verdade para cada segredo/senha.** Compose interpola do
   ambiente exportado (NÃO lê o `.env` da raiz — project dir é `deploy/`).
   Scripts que geram credenciais (`pgbouncer-userlist.sh`) devem consumir a
   MESMA fonte; divergência = `SASL authentication failed` em produção.
3. **Permissão através do uid do container.** Arquivo montado precisa ser legível
   pelo usuário que roda o processo (PgBouncer = uid `postgres`; `chmod 600`
   de outro uid = "no such user" para todos). Verificar `USER` no Dockerfile oficial.
4. **Pooler não é Postgres direto.** PgBouncer `transaction` rejeita startup
   parameters desconhecidos (`statement_timeout`, ...), prepared statements
   nomeados e `FOR UPDATE` sensível — enforcement vai em `ALTER ROLE`, e o
   caminho quente é testado ATRAVÉS do pooler (`pgbouncer-forupdate-check.sh`),
   nunca só direto.
5. **Versão do Prisma é única.** Pin em `PRISMA_VERSION` (default `6.8.0`) de
   `migrate-all.sh` / `prisma-validate.sh` / `migrate-diff-check.sh`, sempre via
   `npx prisma@${PRISMA_VERSION}`. O pacote `libs/database` foi removido em D-5
   (código morto, 0 importadores) — o pin não mora mais em package.json.
   `previewFeatures` válidas dependem da versão (6.8.0 exige `["multiSchema"]`
   p/ `@@schema`; `prismaSchemaFolder` não se aplica a 9 datasources independentes).
6. **Jobs agendados ≠ jobs de push.** Nightly roda scan completo (gitleaks acha
   o que o diff-scan não vê) e stack completa (migrate+seed+forupdate). Antecipar:
   allowlists versionadas (`.gitleaks.toml`, `.trivyignore` com `exp:` sem espaço
   e justificativa), e tudo que o nightly toca deve ter passado no e2e de push.
7. **Action externa se configura explícito.** `trivy-action` não lê `.trivyignore`
   sozinha (passar `trivyignores:`) e apaga o filtro de severidade no modo sarif
   (passar `limit-severities-for-sarif: true`) — sem isso o gate falha em LOW.
8. **Reproduzir o CI local com o binário exato.** Mesma versão da ferramenta
   (`trivy 0.70.0`, `gitleaks 8.24.3`), mesmos flags do workflow. "Passou numa
   versão diferente" não conta.
9. **Diagnóstico por serviço no CI.** Falha de e2e imprime corpo do `/ready`,
   `ps` e logs separados (`postgres`, `pgbouncer`, `api`) — nunca um `logs`
   genérico que esconda o culpado.
10. **Docs vivos andam junto.** Mudança de infra atualiza runbooks, diagramas
    (`.md` + `.html`), `.env.example` e índices (`knowledge:build` + `knowledge-v2`
    rebuild). Histórico (`PHASE-*`, ADRs antigas) nunca é reescrito.
11. **Um commit por etapa, aceite antes de avançar.** Correção sem evidência de
    log é chute — ler o log do CI, identificar a causa raiz, corrigir, ver verde.
12. **Gate fantasma não conta.** O turbo anuncia um pacote na tarefa mesmo quando
    o script não existe na `package.json` dele (dry-run: `command: "<NONEXISTENT>"`).
    Foi assim que `typecheck` nas 4 apps virou "verde" checando só as libs.
    `pnpm gates:check` cobra a matriz (`tools/gates-matrix.json`) e reprova pacote
    sem a tarefa; isenção viva exige motivo + `review_by`, e **isenção já cumprida
    reprova** (dívida que não expira visível).
13. **Gerado à mão se compara, não se confia.** Artefato derivado de uma fonte
    única é gerado por script determinístico e conferido por `--check` no CI;
    divergência reprova apontando arquivo e linha. Exemplo vivo: o catálogo de
    plataformas tem UMA fonte (`libs/contracts/src/products.catalog.json`) e 1
    artefato derivado (`libs/contracts/src/products.catalog.generated.ts`,
    `pnpm catalog:sync`); api/admin/portal consomem via dependência `workspace:*`
    do pacote — `pnpm catalog:check` (job lint) cobra o drift do artefato, que os
    apps **não** voltem a ter cópia/gerado local e que declarem `workspace:*`,
    reprova PNG faltando e PNG **órfão** em `apps/{admin,portal}/public/tags`,
    e sai com `2` quando a própria fonte é inválida (id/chave/modo). Editar gerado
    à mão é sempre erro — o próximo `--check` reprova.
14. **Teste e2e roda no modo de teste, não "quase produção".** `apps/api/test/setup-e2e.ts`
    fixa `AUTH_REPO=memory` (`??=`): os specs usam os repositórios em memória
    (`.seed()`); apontar os guards para PG real quebra com
    `sessions.seed is not a function` (E-1 — 18 falhas). O job `unit` roda
    `pnpm test:e2e`: suíte e2e verde faz parte do push (42 testes; 2 skips por design).

## 3. Veredito

Verde = todos os jobs do push + nightly sem X. Amarelo/skip só onde o workflow
prevê (`clone-ready` fora de schedule). Vermelho, em qualquer job, trava a fase.

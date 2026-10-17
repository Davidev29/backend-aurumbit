# Diretriz CI-Verde — norma permanente deste repositório

> Toda implementação deve nascer prevendo CI verde, sem quebrar nada.
> Tudo verde no local E no remoto antes de considerar pronto.
> Nasceu dos incidentes reais da Fase 9 (documentados em `.planning/PHASE-9-REPORT.md`).

## 1. Portão local obrigatório (antes de qualquer commit)

```bash
bash deploy/scripts/prisma-validate.sh          # 9/9 schemas
pnpm gates:check                                # cobertura de gates por workspace (turbo não pode ser "fantasma")
pnpm turbo run lint typecheck test build --continue   # 12/12 workspaces, inclui as 4 apps
bash -n deploy/scripts/*.sh                     # sintaxe de todos os scripts
"$BIN/trivy.exe" fs --severity HIGH,CRITICAL --exit-code 1 --no-progress .   # mesmo binário do CI
gitleaks detect --redact --exit-code=2 --no-git # mesma versão do CI (8.24.3)
```

Nenhum push com portão local vermelho. Exceção só para gates que exigem
Docker/rede (e2e, clone-ready) — esses são validados no primeiro CI e
corrigidos em follow-up imediato, nunca "depois".

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
5. **Versão do Prisma é única.** Pin em `libs/database` = versão do `npx` em
   `migrate-all.sh`/`prisma-validate.sh`. `previewFeatures` válidas dependem da
   versão (6.8.0 exige `["multiSchema"]` p/ `@@schema`; `prismaSchemaFolder`
   não se aplica a 9 datasources independentes).
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
    única (ex.: catálogo de plataformas) é gerado por script determinístico e
    conferido por `--check` no CI; divergência reprova apontando arquivo e linha.

## 3. Veredito

Verde = todos os jobs do push + nightly sem X. Amarelo/skip só onde o workflow
prevê (`clone-ready` fora de schedule). Vermelho, em qualquer job, trava a fase.

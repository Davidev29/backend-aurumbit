<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Knowledge graph DEV-ONLY (obrigatório p/ IAs e agentes)

Grafo de conhecimento ponta a ponta do repo, isolado em `docs/knowledge-v2/`
(Kuzu embarcado + JSON). DEV-ONLY: nunca é importado por `apps/`, `libs/`,
`prisma/` ou `deploy/`; nunca sobe em prod.

- **Ao INICIAR qualquer trabalho:** orientar-se pelo grafo antes de codar.
  `cd docs/knowledge-v2 && node query.js "<tema da tarefa>" --limit 8`
  (ou `--json` p/ consumo por agente). Citar o `path` retornado como fonte.
- **Ao TERMINAR qualquer tarefa:** rebuildar o grafo para mantê-lo atualizado.
  `cd docs/knowledge-v2 && npm run rebuild`
  (equivale a `node ingest.js && node ingest-kuzu.js`).
- Se o rebuild falhar, o modo JSON continua valendo — nunca deixar o erro
  vazar p/ build/test/prod. Detalhes em `docs/knowledge-v2/README.md`.

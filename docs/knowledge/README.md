# Knowledge Graph + RAG local — Aurum Bit

Base de conhecimento para suporte com LLMs: **grafo** (módulos, rotas, eventos,
regras, segredos) + **chunks RAG** (trechos pesquisáveis com fonte).

Sem dependências externas, sem rede, sem custo. Tudo em arquivos.

## Arquivos

| Arquivo | O quê |
|---|---|
| `graph.json` | Nós (`module`, `route-group`, `event`, `rule`, `secret`, `queue`) + arestas (`owns`, `emits`, `consumes`, `guards`, `calls`, `needs`) |
| `build.js` | Gera `chunks.json` a partir de `docs/*.md`, `.planning/audits/*.md`, `README.md`, `start-backend.ps1` (cabeçalho) |
| `query.js` | Busca: score por sobreposição de tokens nos chunks + expansão 1-hop no grafo |
| `chunks.json` | Gerado (não editar à mão) |

## Uso

```bash
node docs/knowledge/build.js        # regenera chunks.json
node docs/knowledge/query.js "como funciona o webhook do asaas"
node docs/knowledge/query.js "quais rotas de finance existem" --limit 5
node docs/knowledge/query.js "webhook" --graph  # mostra vizinhança no grafo
```

## Qualidade

- Todo chunk carrega `source` (arquivo) + `section` — a resposta do LLM deve citar a fonte.
- O grafo é curadoria manual a partir do `MAP-REPORT.md` (código > docs). Ao mudar
  rotas/eventos, atualize `graph.json` e rode `build.js`.
- `start-backend.ps1` documenta o ambiente operacional (portas, health, segredos).

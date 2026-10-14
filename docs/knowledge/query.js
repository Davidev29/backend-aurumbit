// query.js — RAG local: retrieval por tokens + expansão 1-hop no grafo.
// Uso: node docs/knowledge/query.js "sua pergunta" [--limit N] [--graph]
// Sem dependências. Rode build.js antes (gera chunks.json).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const LIMIT = Number((flags.find((f) => f.startsWith('--limit=')) || '').split('=')[1]) || 5;
const SHOW_GRAPH = flags.includes('--graph');
const q = args.join(' ').toLowerCase();

if (!q) { console.log('Uso: node docs/knowledge/query.js "pergunta" [--limit=N] [--graph]'); process.exit(1); }

const dir = __dirname;
const { chunks } = JSON.parse(fs.readFileSync(path.join(dir, 'chunks.json'), 'utf8'));
const graph = JSON.parse(fs.readFileSync(path.join(dir, 'graph.json'), 'utf8'));

const STOP = new Set(['o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'e', 'ou', 'que', 'como', 'para', 'por', 'com', 'uma', 'qual', 'quais', 'the', 'of', 'to', 'is', 'are', 'what', 'how']);
const toks = (s) => s.toLowerCase().split(/[^a-z0-9@/._-]+/i).map((t) => t.trim()).filter((t) => t.length > 2 && !STOP.has(t));
const qt = new Set(toks(q));

function score(text) {
  const low = text.toLowerCase();
  let s = 0;
  for (const t of qt) {
    if (low.includes(t)) s += t.length > 6 ? 3 : 1;
  }
  return s;
}

const ranked = chunks
  .map((c, i) => ({ i, s: score(`${c.section} ${c.text}`), c }))
  .filter((r) => r.s > 0)
  .sort((a, b) => b.s - a.s)
  .slice(0, LIMIT);

if (!ranked.length) { console.log('Sem resultados. Tente outros termos ou rode build.js.'); process.exit(0); }

console.log(`Top ${ranked.length} trechos p/ "${args.join(' ')}":\n`);
for (const r of ranked) {
  console.log(`--- [score ${r.s}] ${r.c.source} :: ${r.c.section}`);
  console.log(`${r.c.text.slice(0, 500)}${r.c.text.length > 500 ? '…' : ''}\n`);
}

// Expansão no grafo: nós cujo label/note casa com a query + vizinhos 1-hop.
const hit = graph.nodes.filter((n) => score(`${n.label} ${n.note || ''}`) > 0);
if (SHOW_GRAPH || hit.length) {
  const ids = new Set(hit.map((n) => n.id));
  const rel = graph.edges.filter((e) => ids.has(e.from) || ids.has(e.to));
  for (const e of rel) { ids.add(e.from); ids.add(e.to); }
  console.log('--- grafo (nós relevantes + 1-hop) ---');
  for (const n of graph.nodes.filter((n) => ids.has(n.id))) {
    console.log(`[${n.type}] ${n.label}${n.path ? ` (${n.path})` : ''} — ${n.note || ''}`);
  }
  for (const e of rel) console.log(`  ${e.from} --${e.rel}--> ${e.to}`);
}

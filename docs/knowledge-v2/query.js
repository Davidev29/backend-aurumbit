// query.js — DEV-ONLY, zero-dep. Lê ./data/graph.json (gerado por ingest.js)
// com fallback p/ ../knowledge/graph.json (seed). Nunca toca prod.
// Uso:
//   node query.js "webhook asaas" [--limit 8] [--graph] [--json]
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const GEN = path.join(HERE, 'data', 'graph.json');
const SEED = path.join(HERE, '..', 'knowledge', 'graph.json');

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
// remove valor de --limit quando em forma separada ("--limit 5")
const argvForTerms = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  if (argv[i - 1] === '--limit') return false;
  return true;
});
const terms = argvForTerms.join(' ');
let LIMIT = 8;
const eq = (flags.find((f) => f.startsWith('--limit=')) || '').split('=')[1];
if (eq) LIMIT = Number(eq) || 8;
else {
  const i = argv.indexOf('--limit');
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) LIMIT = Number(argv[i + 1]) || 8;
}
const SHOW_GRAPH = flags.includes('--graph') || true; // grafo sempre útil p/ agente
const AS_JSON = flags.includes('--json');

if (!terms) {
  console.log('Uso: node query.js "pergunta" [--limit=8] [--json]');
  console.log('Ex: node query.js "webhook asaas" / node query.js "finance routes" --json');
  process.exit(1);
}

let graph;
for (const p of [GEN, SEED]) {
  try { graph = JSON.parse(fs.readFileSync(p, 'utf8')); console.error(`# fonte: ${path.relative(path.resolve(HERE, '..', '..'), p)} (${graph.nodes.length} nós)`); break; } catch {}
}
if (!graph) { console.error('sem grafo: rode node ingest.js primeiro'); process.exit(1); }

const STOP = new Set(['dos', 'das', 'como', 'para', 'por', 'com', 'uma', 'que', 'quais', 'qual', 'the', 'and', 'for', 'are', 'what', 'how', 'com', 'sem', 'sao', 'dos']);
const toks = (s) => s.toLowerCase().split(/[^a-z0-9@/._-]+/i).map((t) => t.trim()).filter((t) => t.length > 2 && !STOP.has(t));
const qt = toks(terms);

function score(n) {
  const label = (n.label || '').toLowerCase();
  const note = (n.note || '').toLowerCase();
  const pth = (n.path || '').toLowerCase();
  const id = (n.id || '').toLowerCase();
  let s = 0;
  for (const t of qt) {
    if (label === t) s += 10;
    else if (label.includes(t)) s += t.length > 5 ? 5 : 3;
    if (id.includes(t)) s += 2;
    if (pth.includes(t)) s += 2;
    if (note.includes(t)) s += t.length > 5 ? 3 : 1;
  }
  // bônus: seed curado vale mais que auto
  if (s > 0 && n.seed) s += 1;
  return s;
}

const ranked = graph.nodes.map((n) => ({ n, s: score(n) })).filter((r) => r.s > 0)
  .sort((a, b) => b.s - a.s).slice(0, LIMIT);

if (!ranked.length) {
  console.log(JSON.stringify({ query: terms, results: [], hint: 'sem match; rode node ingest.js e tente termos do código (ex: landpage, checkout, dashboard, portal, admin, billing, webhook, finance, license)' }, null, 1));
  process.exit(0);
}

const hitIds = new Set(ranked.map((r) => r.n.id));
const relEdges = graph.edges.filter((e) => hitIds.has(e.from) || hitIds.has(e.to));
if (SHOW_GRAPH) for (const e of relEdges) { hitIds.add(e.from); hitIds.add(e.to); }
const neighbors = graph.nodes.filter((n) => hitIds.has(n.id) && !ranked.find((r) => r.n.id === n.id)).slice(0, 12);

if (AS_JSON) {
  console.log(JSON.stringify({ query: terms, results: ranked.map((r) => ({ score: r.s, ...r.n })), neighbors, edges: relEdges.slice(0, 40) }, null, 1));
} else {
  console.log(`\nTop ${ranked.length} p/ "${terms}":\n`);
  for (const r of ranked) {
    console.log(`- [${r.s}] [${r.n.type}] ${r.n.label}${r.n.path ? ` (${r.n.path})` : ''}${r.n.seed ? ' [seed]' : ''}`);
    if (r.n.note) console.log(`    ${r.n.note.slice(0, 220)}`);
  }
  if (neighbors.length) {
    console.log(`\nVizinhança 1-hop (${neighbors.length}):`);
    for (const n of neighbors) console.log(`  [${n.type}] ${n.label}`);
  }
  if (relEdges.length) {
    console.log(`\nArestas (${Math.min(relEdges.length, 20)} de ${relEdges.length}):`);
    for (const e of relEdges.slice(0, 20)) console.log(`  ${e.from} --${e.rel}--> ${e.to}`);
  }
  console.log('\n# Cite a fonte (path) ao responder. DEV-ONLY, sem efeito em prod.');
}

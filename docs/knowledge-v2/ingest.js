// ingest.js — DEV-ONLY, zero-dep, 100% leitura fora desta pasta.
// Le: ../knowledge/graph.json (seed manual), apps/api controllers, prisma schemas.
// Escreve SOMENTE em ./data/ (descartável, gitignored).
// Uso: node ingest.js
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(HERE, 'data');
const SEED_PATH = path.join(HERE, '..', 'knowledge', 'graph.json');

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function listFilesRecursive(dir, filter) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') continue;
      out.push(...listFilesRecursive(full, filter));
    } else if (!filter || filter(full)) out.push(full);
  }
  return out;
}

// 1. Seed manual (preserva curadoria existente)
let seed = { nodes: [], edges: [] };
const seedRaw = readIfExists(SEED_PATH);
if (seedRaw) {
  try { seed = JSON.parse(seedRaw); } catch (e) { console.log('seed ilegível:', e.message); }
}
console.log(`seed: ${seed.nodes.length} nós, ${seed.edges.length} arestas <- ${path.relative(ROOT, SEED_PATH)}`);

const nodes = new Map(); // id -> node
const edges = new Map(); // from|rel|to -> edge
function addNode(n) {
  if (!n || !n.id) return;
  if (!nodes.has(n.id)) nodes.set(n.id, n);
  else nodes.set(n.id, { ...nodes.get(n.id), ...n, note: n.note || nodes.get(n.id).note });
}
function addEdge(from, rel, to) {
  const k = `${from}|${rel}|${to}`;
  if (!edges.has(k)) edges.set(k, { from, rel, to, auto: true });
}
for (const n of seed.nodes || []) addNode({ ...n, seed: true });
for (const e of seed.edges || []) {
  const k = `${e.from}|${e.rel}|${e.to}`;
  if (!edges.has(k)) edges.set(k, { ...e });
}

// 2. Módulos Nest (pastas) — garante nó module mesmo sem seed
const modulesDir = path.join(ROOT, 'apps', 'api', 'src', 'modules');
let moduleDirs = [];
try { moduleDirs = fs.readdirSync(modulesDir).filter((d) => fs.statSync(path.join(modulesDir, d)).isDirectory()); } catch {}
for (const m of moduleDirs) {
  addNode({ id: `mod:${m}`, type: 'module', label: m, path: `apps/api/src/modules/${m}`, auto: true, note: 'módulo Nest (auto-ingest)' });
}

// 3. Controllers -> route nodes + owns edges
const controllers = listFilesRecursive(modulesDir, (f) => f.endsWith('.controller.ts'));
let routeCount = 0;
const verbRe = /@(Get|Post|Put|Patch|Delete)\(\s*['"`]([^'"`)]*)['"`]?\s*\)/g;
const ctrlRe = /@Controller\(\s*['"`]([^'"`]+)['"`]/;
const publicRe = /@Public\(\)/;
for (const file of controllers) {
  const text = readIfExists(file) || '';
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const modName = rel.split('/')[4] || 'unknown';
  const ctrlMatch = text.match(ctrlRe);
  const base = (ctrlMatch ? ctrlMatch[1] : '').replace(/^\/+|\/+$/g, '');
  // registra arquivo como nó file (útil p/ agentes citarem fonte)
  addNode({ id: `file:${rel}`, type: 'file', label: rel.split('/').pop(), path: rel, auto: true, note: `controller do módulo ${modName}` });
  addEdge(`mod:${modName}`, 'owns', `file:${rel}`);
  let m;
  verbRe.lastIndex = 0;
  const isPublicFile = publicRe.test(text);
  while ((m = verbRe.exec(text))) {
    const verb = m[1].toUpperCase();
    const sub = (m[2] || '').replace(/^\/+|\/+$/g, '');
    const full = ['/v1', base, sub].filter(Boolean).join('/').replace(/\/+/g, '/');
    const id = `route:${verb} ${full}`;
    addNode({
      id, type: 'route-group', label: `${verb} ${full}`,
      path: rel, auto: true,
      note: `auto de ${rel.split('/').pop()}${isPublicFile ? ' (arquivo contém @Public)' : ''}`,
    });
    addEdge(`mod:${modName}`, 'owns', id);
    addEdge(`file:${rel}`, 'owns', id);
    routeCount++;
  }
}
console.log(`controllers: ${controllers.length} arquivos, ${routeCount} rotas (auto)`);

// 4. Prisma schemas -> db-model nodes + owns do domínio
const prismaFiles = listFilesRecursive(path.join(ROOT, 'prisma'), (f) => f.endsWith('schema.prisma'));
let modelCount = 0;
for (const file of prismaFiles) {
  const text = readIfExists(file) || '';
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const domain = rel.split('/')[1] || 'unknown';
  const re = /model\s+(\w+)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const id = `db:${domain}.${m[1]}`;
    addNode({ id, type: 'db-model', label: `${domain}.${m[1]}`, path: rel, auto: true, note: `model Prisma do domínio ${domain}` });
    addEdge(`mod:${domain}`, 'owns', id);
    modelCount++;
  }
}
console.log(`prisma: ${prismaFiles.length} schemas, ${modelCount} models (auto)`);

// 5. Queues/eventos via grep simples em workers (sem parse pesado)
const workersSrc = path.join(ROOT, 'apps', 'workers', 'src');
const workerFiles = listFilesRecursive(workersSrc, (f) => f.endsWith('.ts'));
const queueRe = /['"`]([a-z][a-z0-9._-]*\.[a-z0-9._-]+|[a-z]+\.[a-z]+(?:\.[a-z]+)+)['"`]/gi;
let queueHits = 0;
for (const file of workerFiles.slice(0, 60)) { // teto p/ ingest rápido
  const text = readIfExists(file) || '';
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let m;
  queueRe.lastIndex = 0;
  while ((m = queueRe.exec(text))) {
    const v = m[1];
    if (v.includes('.') && (v.includes('billing') || v.includes('finance') || v.includes('licensing') || v.includes('comm') || v.endsWith('.v1'))) {
      const id = v.endsWith('.v1') ? `ev:${v}` : `q:${v}`;
      const exists = nodes.has(id);
      if (!exists) {
        addNode({ id, type: v.endsWith('.v1') ? 'event' : 'queue', label: v, path: rel, auto: true, note: `auto de ${rel.split('/').pop()}` });
        queueHits++;
      }
    }
  }
}
console.log(`workers: ${workerFiles.length} arquivos varridos, +${queueHits} eventos/filas novos`);

// 6. Escreve SOMENTE em ./data/
fs.mkdirSync(OUT_DIR, { recursive: true });
const graph = {
  version: '2.0.0-dev',
  generated_at: new Date().toISOString(),
  generated_from: 'seed ../knowledge/graph.json + scan read-only de apps/api, prisma, apps/workers',
  stats: {
    seed_nodes: (seed.nodes || []).length,
    total_nodes: nodes.size,
    total_edges: edges.size,
    controllers: controllers.length,
    routes_auto: routeCount,
    models_auto: modelCount,
  },
  nodes: [...nodes.values()],
  edges: [...edges.values()],
};
fs.writeFileSync(path.join(OUT_DIR, 'graph.json'), JSON.stringify(graph, null, 1));
// índice simples p/ query rápida (token -> ids)
const idx = {};
for (const n of graph.nodes) {
  const hay = `${n.id} ${n.label || ''} ${n.note || ''} ${n.path || ''}`.toLowerCase();
  for (const tok of hay.split(/[^a-z0-9@/._-]+/i)) {
    const t = tok.trim();
    if (t.length < 3) continue;
    (idx[t] = idx[t] || []).push(n.id);
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({ built_at: graph.generated_at, tokens: Object.keys(idx).length, index: idx }));
console.log(`OK: ${graph.nodes.length} nós, ${graph.edges.length} arestas -> ${path.relative(ROOT, path.join(OUT_DIR, 'graph.json'))}`);
console.log('NADA fora de docs/knowledge-v2/data/ foi escrito. Prod intacto.');

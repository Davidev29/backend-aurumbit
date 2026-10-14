// ingest.js — DEV-ONLY, zero-dep, 100% leitura fora desta pasta.
// Le TUDO da aplicação (read-only) e escreve SOMENTE em ./data/ (descartável, gitignored).
// Fontes:
//   1. ../knowledge/graph.json (seed manual curado — preservado com flag seed)
//   2. apps/api/src/modules/*/*.controller.ts (@Controller + verbos → route:*)
//   3. apps/api/src/**/*.service.ts (→ svc:*)
//   4. prisma/*/schema.prisma (model X → db:<dominio>.<model>)
//   5. apps/workers/src/**/*.ts (strings *.v1 / filas → ev:* / q:*)
//   6. apps/portal/app/**/page.tsx (→ ui-page:portal:*) + app/api/**/route.ts (→ bff:portal:*)
//   7. apps/admin/app/**/page.tsx (→ ui-page:admin:*) + app/api/**/route.ts (→ bff:admin:*)
//   8. apps/portal/{components,lib,hooks}/** (→ ui-section:* / fe-lib:* / file:*)
//   9. apps/admin/{components,lib,stores}/** (→ file:*)
//   10. libs/* (→ lib:* + file:*)
//   11. deploy/docker-compose*.yml + scripts (→ infra:*)
//   12. docs/*.md (→ doc:*)
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
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);
function listFilesRecursive(dir, filter) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...listFilesRecursive(full, filter));
    } else if (!filter || filter(full)) out.push(full);
  }
  return out;
}
const posix = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// 1. Seed manual (preserva curadoria existente)
let seed = { nodes: [], edges: [] };
const seedRaw = readIfExists(SEED_PATH);
if (seedRaw) {
  try { seed = JSON.parse(seedRaw); } catch (e) { console.log('seed ilegível:', e.message); }
}
console.log(`seed: ${seed.nodes.length} nós, ${seed.edges.length} arestas <- ${posix(SEED_PATH)}`);

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

// Módulos lógicos extras (frontends, bffs, deploy, docs) — garante nó mesmo sem seed
const extraMods = [
  ['mod:portal', 'portal', 'apps/portal', 'Next.js :3002 — vitrine pública + área do cliente (landpage, checkout, dashboard)'],
  ['mod:portal-bff', 'portal-bff', 'apps/portal/app/api', 'BFF do portal (route.ts proxy-ou-mock, fail-closed 502 sem upstream)'],
  ['mod:admin-ui', 'admin-ui', 'apps/admin', 'Next.js :3001 — operação (dashboard, clientes, cobranças, financeiro, filas)'],
  ['mod:admin-bff', 'admin-bff', 'apps/admin/app/api', 'BFF do admin (route.ts proxy-ou-mock, Idempotency-Key repassado)'],
  ['mod:libs', 'libs', 'libs', 'Pacotes compartilhados (contracts, events, adapters, security, database)'],
  ['mod:deploy', 'deploy', 'deploy', 'Compose base + override prod + Caddy + scripts migrate/seed/backup/smoke'],
  ['mod:docs', 'docs', 'docs', 'ADRs, ARCHITECTURE, LGPD, SECURITY, SLOs, RUNBOOKS'],
];
for (const [id, label, p, note] of extraMods) {
  if (!nodes.has(id)) addNode({ id, type: 'module', label, path: p, auto: true, note });
}
// alias: seed usa mod:bff (= admin-bff). Garante equivalência via aresta.
addEdge('mod:admin-bff', 'aliases', 'mod:bff');

// 2. Módulos Nest (pastas) — garante nó module mesmo sem seed
const modulesDir = path.join(ROOT, 'apps', 'api', 'src', 'modules');
let moduleDirs = [];
try { moduleDirs = fs.readdirSync(modulesDir).filter((d) => fs.statSync(path.join(modulesDir, d)).isDirectory()); } catch {}
for (const m of moduleDirs) {
  addNode({ id: `mod:${m}`, type: 'module', label: m, path: `apps/api/src/modules/${m}`, auto: true, note: 'módulo Nest (auto-ingest)' });
}

// 3. Controllers -> route nodes + owns edges (todos os controllers da API, não só modules)
const apiSrc = path.join(ROOT, 'apps', 'api', 'src');
const controllers = listFilesRecursive(apiSrc, (f) => f.endsWith('.controller.ts'));
let routeCount = 0;
const verbRe = /@(Get|Post|Put|Patch|Delete)\(\s*['"`]([^'"`)]*)['"`]?\s*\)/g;
const ctrlRe = /@Controller\(\s*['"`]([^'"`]+)['"`]/;
const publicRe = /@Public\(\)/;
for (const file of controllers) {
  const text = readIfExists(file) || '';
  const rel = posix(file);
  const parts = rel.split('/');
  const mi = parts.indexOf('modules');
  const modName = (mi >= 0 && parts[mi + 1]) ? parts[mi + 1] : (parts.includes('health') ? 'health' : 'unknown');
  const ctrlMatch = text.match(ctrlRe);
  const base = (ctrlMatch ? ctrlMatch[1] : '').replace(/^\/+|\/+$/g, '');
  addNode({ id: `file:${rel}`, type: 'file', label: rel.split('/').pop(), path: rel, auto: true, note: `controller do módulo ${modName}` });
  addEdge(`mod:${modName}`, 'owns', `file:${rel}`);
  let m;
  verbRe.lastIndex = 0;
  const isPublicFile = publicRe.test(text);
  while ((m = verbRe.exec(text))) {
    const verb = m[1].toUpperCase();
    const sub = (m[2] || '').replace(/^\/+|\/+$/g, '');
    const prefix = base.startsWith('health') || base.startsWith('metrics') || base.startsWith('webhooks') ? '' : '/v1';
    const full = [prefix, base, sub].filter(Boolean).join('/').replace(/\/+/g, '/');
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

// 3b. Services Nest -> svc nodes (quem implementa a regra de cada domínio)
const services = listFilesRecursive(apiSrc, (f) => f.endsWith('.service.ts'));
let svcCount = 0;
for (const file of services) {
  const rel = posix(file);
  const parts = rel.split('/');
  const mi = parts.indexOf('modules');
  const modName = (mi >= 0 && parts[mi + 1]) ? parts[mi + 1] : 'common';
  const base = path.basename(file, '.service.ts');
  const id = `svc:${modName}.${base}`;
  addNode({ id, type: 'be-service', label: `${modName}.${base}`, path: rel, auto: true, note: `service do módulo ${modName} (regra de negócio)` });
  addEdge(`mod:${modName}`, 'owns', id);
  addEdge(id, 'impl-in', `file:${rel}`);
  svcCount++;
}
console.log(`services: ${services.length} arquivos (svc nodes: ${svcCount})`);

// 4. Prisma schemas -> db-model nodes + owns do domínio
const prismaFiles = listFilesRecursive(path.join(ROOT, 'prisma'), (f) => f.endsWith('schema.prisma'));
let modelCount = 0;
for (const file of prismaFiles) {
  const text = readIfExists(file) || '';
  const rel = posix(file);
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

// 5. Queues/eventos via grep em workers (todos os arquivos, sem teto arbitrário baixo)
const workersSrc = path.join(ROOT, 'apps', 'workers', 'src');
const workerFiles = listFilesRecursive(workersSrc, (f) => f.endsWith('.ts'));
const queueRe = /['"`]([a-z][a-z0-9._-]*\.[a-z0-9._-]+|[a-z]+\.[a-z]+(?:\.[a-z]+)+)['"`]/gi;
const queueAllow = /(billing|finance|licensing|comm|access|projection|outbox|recon|sync|evaluate|fanout|dlq|\.v1$)/i;
let queueHits = 0;
for (const file of workerFiles) {
  if (file.endsWith('.spec.ts')) continue;
  const text = readIfExists(file) || '';
  const rel = posix(file);
  let m;
  queueRe.lastIndex = 0;
  while ((m = queueRe.exec(text))) {
    const v = m[1];
    if (v.includes('.') && queueAllow.test(v)) {
      const id = v.endsWith('.v1') ? `ev:${v}` : `q:${v}`;
      if (!nodes.has(id)) {
        addNode({ id, type: v.endsWith('.v1') ? 'event' : 'queue', label: v, path: rel, auto: true, note: `auto de ${rel.split('/').pop()}` });
        queueHits++;
      }
    }
  }
  // BullMQ queue names literais: new Queue('nome') / Worker('nome')
  const qNameRe = /(?:new\s+(?:Queue|Worker|QueueEvents)\s*\(\s*|queueName\s*=\s*)['"`]([a-z0-9._-]+)['"`]/gi;
  let qm;
  while ((qm = qNameRe.exec(text))) {
    const v = qm[1];
    const id = `q:${v}`;
    if (!nodes.has(id)) {
      addNode({ id, type: 'queue', label: v, path: rel, auto: true, note: `fila BullMQ em ${rel.split('/').pop()}` });
      queueHits++;
    }
    addEdge('mod:workers', 'owns', id);
  }
}
console.log(`workers: ${workerFiles.length} arquivos varridos, +${queueHits} eventos/filas novos`);

// 6+7. Frontends Next.js: pages (ui-page) + BFF route.ts (bff-route)
function nextUrlFromAppFile(appDir, file) {
  // appDir=.../app, file=.../app/dashboard/faturas/page.tsx → /dashboard/faturas
  const rel = path.relative(appDir, file).replace(/\\/g, '/');
  const dir = path.posix.dirname(rel); // '.' | 'checkout' | 'dashboard/faturas' | 'api/me/...'
  if (dir === '.') return '/';
  const parts = dir.split('/').filter(Boolean).map((seg) => {
    if (/^\(.*\)$/.test(seg)) return null; // route group (app)/(app) → some da URL
    return seg;
  }).filter(Boolean);
  return '/' + parts.join('/');
}
const methodRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g;
function indexNextApp(appName, modPage, modBff) {
  const appDir = path.join(ROOT, 'apps', appName, 'app');
  const pages = listFilesRecursive(appDir, (f) => f.endsWith('/page.tsx') || f.endsWith('\\page.tsx') || path.basename(f) === 'page.tsx');
  let pc = 0;
  for (const file of pages) {
    const rel = posix(file);
    const url = nextUrlFromAppFile(appDir, file);
    const id = `ui-page:${appName}:${url === '/' ? '/ (landpage)' : url}`;
    const isLand = url === '/';
    addNode({
      id, type: 'ui-page', label: `${appName} ${url === '/' ? '/ (landpage)' : url}`, path: rel, auto: true,
      note: isLand
        ? 'landpage: Hero + seções + ProductsSection + FAQ/HowTo JSON-LD (primeira pintura + SEO)'
        : `tela ${url} (${rel.split('/').pop()})`,
    });
    addEdge(modPage, 'owns', id);
    addEdge(`file:${rel}`, 'part-of', id);
    if (!nodes.has(`file:${rel}`)) addNode({ id: `file:${rel}`, type: 'file', label: path.basename(file), path: rel, auto: true, note: `page de ${appName}${url}` });
    pc++;
  }
  const routes = listFilesRecursive(path.join(appDir, 'api'), (f) => path.basename(f) === 'route.ts');
  let bc = 0;
  for (const file of routes) {
    const text = readIfExists(file) || '';
    const rel = posix(file);
    const url = nextUrlFromAppFile(appDir, file); // já começa com /api/...
    const methods = [...text.matchAll(methodRe)].map((m) => m[1]);
    const list = methods.length ? methods : ['ANY'];
    for (const verb of list) {
      const id = `bff:${appName}:${verb} ${url}`;
      addNode({ id, type: 'bff-route', label: `${verb} ${url} (${appName})`, path: rel, auto: true, note: `BFF ${appName}: proxy upstream ou stub dev / 502 fail-closed em prod` });
      addEdge(modBff, 'owns', id);
      addEdge(`file:${rel}`, 'impl', id);
      bc++;
    }
    if (!nodes.has(`file:${rel}`)) addNode({ id: `file:${rel}`, type: 'file', label: 'route.ts', path: rel, auto: true, note: `BFF handler ${url}` });
  }
  console.log(`${appName}: ${pc} pages, ${routes.length} route.ts (${bc} bff-routes)`);
  return { pc, bc };
}
const portalStats = indexNextApp('portal', 'mod:portal', 'mod:portal-bff');
const adminStats = indexNextApp('admin', 'mod:admin-ui', 'mod:admin-bff');
// BFF legado do seed (mod:bff) também é dono das rotas admin (compat)
for (const [id, n] of [...nodes]) {
  if (n.type === 'bff-route' && n.path && n.path.startsWith('apps/admin/')) addEdge('mod:bff', 'owns', id);
}

// 8. Portal: sections + lib + components (a landpage vira buscável termo a termo)
const sectionFiles = listFilesRecursive(path.join(ROOT, 'apps', 'portal', 'components', 'sections'), (f) => f.endsWith('.tsx'));
let secCount = 0;
for (const file of sectionFiles) {
  const rel = posix(file);
  const name = path.basename(file, '.tsx'); // Hero, Products, Faq, ...
  const id = `ui-section:${name}`;
  const synonyms = {
    Hero: 'landpage hero vitrine chamada capa dobra topo headline CTA',
    Products: 'landpage produtos planos preços vitrine catálogo programs pricing',
    ProductSpotlight: 'landpage vitrine produto spotlight editorial programa',
    Summary: 'landpage resumo llm citável tl;dr summary',
    Purpose: 'landpage propósito offline por-natureza manifesto',
    HowItWorks: 'landpage como-funciona passos howto ativação chave instalação',
    Services: 'landpage serviços sob-medida enterprise mailto cnpj',
    AiAgents: 'landpage agentes ia agentes-ai automação',
    CostBenefit: 'landpage custo-benefício economia comparação vaidade prova',
    Assurance: 'landpage garantia confiança assurance prova lgpd suporte',
    Faq: 'landpage faq perguntas respostas dúvida pagamento cancelamento fiscal',
    FinalCTA: 'landpage cta final conversão botão ver-planos footer',
    TrustBar: 'landpage trustbar prova social selo faixa',
  }[name] || 'landpage seção vitrine';
  addNode({ id, type: 'ui-section', label: `${name} (landpage /)`, path: rel, auto: true, note: `seção da landpage em ${rel.split('/').pop()} — ${synonyms}` });
  addEdge('mod:portal', 'owns', id);
  addEdge(id, 'renders-in', 'ui-page:portal:/ (landpage)');
  secCount++;
}
// landpage aliases diretos: garante match para "landpage/landing/landingpage/vitrine"
for (const alias of ['landpage', 'landing', 'landingpage', 'vitrine', 'site público', 'página inicial', 'homepage']) {
  addNode({ id: `alias:${alias}`, type: 'alias', label: alias, path: 'apps/portal/app/page.tsx', auto: true, note: `alias → ui-page:portal:/ (landpage). Termo buscável da vitrine.` });
  addEdge(`alias:${alias}`, 'refers-to', 'ui-page:portal:/ (landpage)');
}
console.log(`portal sections: ${secCount} seções indexadas + aliases de landpage`);

// fe-lib do portal (capabilities, catalog, mocks, theme...) + arquivos gerais portal/admin
const portalLibFiles = listFilesRecursive(path.join(ROOT, 'apps', 'portal', 'lib'), (f) => f.endsWith('.ts') || f.endsWith('.tsx'));
let libCount = 0;
for (const file of portalLibFiles) {
  const rel = posix(file);
  const name = path.basename(file);
  const id = `fe-lib:portal:${name}`;
  const extra = name === 'capabilities.ts' ? 'espelha WEB_* × DESKTOP_* p/ badges (UI indica, API decide)'
    : name === 'mocks.ts' ? 'catálogo stub da primeira pintura / dev sem upstream'
    : name === 'nest-catalog.ts' ? 'enriquece+normaliza catálogo Nest p/ cards'
    : name.startsWith('theme') ? 'transição de tema (View Transitions / vidro)'
    : 'lib do portal';
  addNode({ id, type: 'fe-lib', label: `portal/lib/${name}`, path: rel, auto: true, note: `${extra}. Landpage, checkout e dashboard consomem.` });
  addEdge('mod:portal', 'owns', id);
  libCount++;
}
console.log(`portal lib: ${libCount} arquivos`);

// components + stores + hooks + middleware (portal e admin) como file nodes citáveis
const feExtraDirs = [
  'apps/portal/components', 'apps/portal/hooks',
  'apps/admin/components', 'apps/admin/lib', 'apps/admin/stores',
];
let feFileCount = 0;
for (const d of feExtraDirs) {
  const files = listFilesRecursive(path.join(ROOT, d), (f) => /\.(tsx?|css)$/.test(f));
  for (const file of files) {
    const rel = posix(file);
    const id = `file:${rel}`;
    if (!nodes.has(id)) {
      const owner = rel.startsWith('apps/portal') ? 'mod:portal' : 'mod:admin-ui';
      addNode({ id, type: 'file', label: path.basename(file), path: rel, auto: true, note: `arquivo frontend (${d})` });
      addEdge(owner, 'owns', id);
      feFileCount++;
    }
  }
}
for (const mw of ['apps/portal/middleware.ts', 'apps/admin/middleware.ts']) {
  const rel = mw;
  if (readIfExists(path.join(ROOT, mw)) && !nodes.has(`file:${rel}`)) {
    addNode({ id: `file:${rel}`, type: 'file', label: 'middleware.ts', path: rel, auto: true, note: 'middleware Next (auth/redirect da borda)' });
    addEdge(rel.includes('portal') ? 'mod:portal' : 'mod:admin-ui', 'owns', `file:${rel}`);
    feFileCount++;
  }
}
console.log(`frontend files extras: +${feFileCount}`);

// 10. libs/* pacotes + arquivos
const libsRoot = path.join(ROOT, 'libs');
let libDirs = [];
try { libDirs = fs.readdirSync(libsRoot).filter((d) => fs.statSync(path.join(libsRoot, d)).isDirectory()); } catch {}
let libFileCount = 0;
for (const l of libDirs) {
  const id = `lib:${l}`;
  addNode({ id, type: 'lib-pkg', label: l, path: `libs/${l}`, auto: true, note: `pacote compartilhado libs/${l} (contratos, crypto, adapters — nunca guarda segredo)` });
  addEdge('mod:libs', 'owns', id);
  const files = listFilesRecursive(path.join(libsRoot, l), (f) => f.endsWith('.ts'));
  for (const file of files.slice(0, 60)) {
    const rel = posix(file);
    const fid = `file:${rel}`;
    if (!nodes.has(fid)) {
      addNode({ id: fid, type: 'file', label: path.basename(file), path: rel, auto: true, note: `fonte de libs/${l}` });
      addEdge(id, 'contains', fid);
      libFileCount++;
    }
  }
}
console.log(`libs: ${libDirs.length} pacotes, +${libFileCount} arquivos`);

// 11. deploy: services do compose + scripts citáveis
const composeFiles = ['deploy/docker-compose.yml', 'deploy/docker-compose.prod.yml', 'deploy/docker-compose.caddy.yml']
  .filter((r) => readIfExists(path.join(ROOT, r)));
let infraCount = 0;
for (const r of composeFiles) {
  const text = readIfExists(path.join(ROOT, r)) || '';
  const inServices = text.split('services:')[1] || text;
  const re = /^\s{2}([a-z0-9][a-z0-9_-]*)\s*:\s*$/gm;
  let m;
  while ((m = re.exec(inServices))) {
    const svc = m[1];
    if (['version', 'networks', 'volumes', 'x-templates'].includes(svc)) continue;
    const id = `infra:${svc}`;
    if (!nodes.has(id)) {
      addNode({ id, type: 'infra', label: svc, path: r, auto: true, note: `serviço do compose em ${r.split('/').pop()} (single-VPS: Caddy TLS → 127.0.0.1:3002/3001/3000)` });
      infraCount++;
    }
    addEdge('mod:deploy', 'owns', id);
  }
}
const scriptFiles = listFilesRecursive(path.join(ROOT, 'deploy', 'scripts'), (f) => f.endsWith('.sh'));
for (const file of scriptFiles) {
  const rel = posix(file);
  const id = `infra-script:${path.basename(file)}`;
  addNode({ id, type: 'infra-script', label: path.basename(file), path: rel, auto: true, note: 'script operacional (migrate/seed/backup/smoke/restore)' });
  addEdge('mod:deploy', 'owns', id);
  infraCount++;
}
console.log(`deploy: ${composeFiles.length} composes, ${scriptFiles.length} scripts, ${infraCount} nós infra`);

// 12. docs/*.md (ADRs, arquitetura, compliance) — título real como label
const docFiles = listFilesRecursive(path.join(ROOT, 'docs'), (f) => f.endsWith('.md'));
let docCount = 0;
for (const file of docFiles) {
  if (file.includes('knowledge-v2')) continue;
  const rel = posix(file);
  const text = readIfExists(file) || '';
  const h1 = (text.match(/^#\s+(.+)/m) || [])[1] || path.basename(file);
  const id = `doc:${path.basename(file)}`;
  addNode({ id, type: 'doc', label: h1.slice(0, 90), path: rel, auto: true, note: `documento ${path.basename(file)} — ${h1.slice(0, 120)}` });
  addEdge('mod:docs', 'owns', id);
  docCount++;
}
console.log(`docs: ${docCount} documentos`);

// 6. Escreve SOMENTE em ./data/
fs.mkdirSync(OUT_DIR, { recursive: true });
const graph = {
  version: '2.1.0-dev',
  generated_at: new Date().toISOString(),
  generated_from: 'seed ../knowledge/graph.json + scan read-only TOTAL: apps/api, prisma, apps/workers, apps/portal, apps/admin, libs, deploy, docs',
  stats: {
    seed_nodes: (seed.nodes || []).length,
    total_nodes: nodes.size,
    total_edges: edges.size,
    controllers: controllers.length,
    routes_auto: routeCount,
    services: svcCount,
    models_auto: modelCount,
    portal_pages: portalStats.pc,
    portal_bff: portalStats.bc,
    admin_pages: adminStats.pc,
    admin_bff: adminStats.bc,
    sections: secCount,
    portal_lib: libCount,
    lib_pkgs: libDirs.length,
    docs: docCount,
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
console.log(`OK: ${graph.nodes.length} nós, ${graph.edges.length} arestas -> ${posix(path.join(OUT_DIR, 'graph.json'))}`);
console.log('NADA fora de docs/knowledge-v2/data/ foi escrito. Prod intacto.');

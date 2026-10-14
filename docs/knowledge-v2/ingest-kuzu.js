// ingest-kuzu.js — OPT-IN DEV-ONLY. Só roda se `npm install` foi executado
// dentro de docs/knowledge-v2 (pasta isolada, fora do pnpm workspace).
// Nunca é importado por apps/, libs/ ou deploy/. Uso: npm run ingest:kuzu
const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, 'data', 'graph.json');
const DB_DIR = path.join(__dirname, 'data', 'graph.kuzu');

async function main() {
  let kuzu;
  try { kuzu = require('kuzu'); } catch {
    console.log('kuzu não instalado (ok — modo JSON continua valendo).');
    console.log('Para ativar: cd docs/knowledge-v2 && npm install');
    process.exit(0);
  }
  if (!fs.existsSync(DATA)) { console.log('rode node ingest.js primeiro'); process.exit(1); }
  const graph = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  const db = new kuzu.Database(DB_DIR);
  const conn = new kuzu.Connection(db);
  await conn.query(`CREATE NODE TABLE KGNode(id STRING, type STRING, label STRING, path STRING, note STRING, PRIMARY KEY(id))`);
  await conn.query(`CREATE REL TABLE LINK(FROM KGNode TO KGNode, rel STRING)`);
  // kuzu 0.9: query() não aceita params — usar prepare()+execute()
  const stmtNode = await conn.prepare(
    `CREATE (:KGNode {id: $id, type: $type, label: $label, path: $path, note: $note})`);
  for (const n of graph.nodes) {
    await conn.execute(stmtNode, {
      id: String(n.id), type: String(n.type || ''), label: String(n.label || ''),
      path: String(n.path || ''), note: String(n.note || '').slice(0, 2000),
    });
  }
  const stmtEdge = await conn.prepare(
    `MATCH (a:KGNode {id: $from}), (b:KGNode {id: $to}) CREATE (a)-[:LINK {rel: $rel}]->(b)`);
  let ok = 0, skip = 0;
  for (const e of graph.edges) {
    try {
      await conn.execute(stmtEdge, { from: String(e.from), to: String(e.to), rel: String(e.rel) });
      ok++;
    } catch { skip++; }
  }
  const r = await conn.query(`MATCH (n:KGNode) RETURN count(n) AS c`);
  const rows = await r.getAll();
  const r2 = await conn.query(`MATCH (:KGNode)-[l:LINK]->(:KGNode) RETURN count(l) AS c`);
  const rows2 = await r2.getAll();
  console.log(`OK kuzu: nos=${JSON.stringify(rows)} arestas=${JSON.stringify(rows2)} (ok=${ok} skip=${skip}/${graph.edges.length}) -> data/graph.kuzu`);
  console.log('Exemplo: MATCH (a:KGNode)-[l:LINK]->(b:KGNode) WHERE a.label CONTAINS \'billing\' RETURN a.label, l.rel, b.label LIMIT 10');
}
main().catch((e) => { console.error('kuzu falhou (JSON segue valendo):', e.message); process.exit(0); });

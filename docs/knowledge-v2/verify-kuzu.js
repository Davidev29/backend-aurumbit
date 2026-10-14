// verify-kuzu.js — DEV-ONLY, teste rápido de precisão do grafo Kuzu.
const kuzu = require('kuzu');
(async () => {
  const db = new kuzu.Database('./data/graph.kuzu');
  const conn = new kuzu.Connection(db);
  const r = await conn.query(
    'MATCH (a:KGNode)-[l:LINK]->(b:KGNode) WHERE a.id = \'mod:billing\' RETURN b.type AS t, b.label AS label, l.rel AS rel LIMIT 8'
  );
  console.log(JSON.stringify(await r.getAll(), null, 1));
})();

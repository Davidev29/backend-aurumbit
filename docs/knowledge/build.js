// build.js — gera docs/knowledge/chunks.json a partir das fontes de verdade.
// Uso: node docs/knowledge/build.js
// Sem dependências. Chunks ≤ ~1200 chars, sempre com source + section.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'chunks.json');

const SOURCES = [
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/knowledge/README.md',
  'docs/LGPD.md',
  'docs/SECURITY.md',
  'docs/SLOs.md',
  'docs/design-system/DS.md',
  '.planning/design/06-componentes.md',
  '.planning/design/08-dados-reais.md',
  '.planning/audits/MAP-REPORT.md',
  '.planning/audits/FINANCE-ASAAS-REPORT.md',
  '.planning/audits/E2E-REPORT.md',
  '.planning/audits/CONSENSO-FIXES.md',
  'deploy/docker-compose.yml',
  '.env.example',
  'start-backend.ps1',
  'apps/admin/app/api/auth/mfa/enroll/route.ts',
  'apps/admin/app/api/auth/mfa/verify/route.ts',
  'apps/admin/app/(auth)/mfa/page.tsx',
  'apps/api/src/modules/auth/auth.controller.ts',
  'apps/api/src/modules/licensing/licensing.module.ts',
  'apps/api/src/modules/billing/webhook.service.ts',
  'apps/api/src/modules/admin/dlq.controller.ts',
];

const MAX = 1200;

function splitSections(file, text) {
  const chunks = [];
  const parts = text.split(/^(#{1,3}\s+.+)$/m);
  let section = '(topo)';
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) {
      for (let i = 0; i < t.length; i += MAX) {
        chunks.push({ source: file, section, text: t.slice(i, i + MAX) });
      }
    }
    buf = '';
  };
  for (const p of parts) {
    if (/^#{1,3}\s+/.test(p)) { flush(); section = p.replace(/^#+\s*/, '').slice(0, 80); }
    else buf += p;
  }
  flush();
  return chunks;
}

const all = [];
for (const f of SOURCES) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) { console.log('skip (ausente):', f); continue; }
  const text = fs.readFileSync(abs, 'utf8');
  const cs = splitSections(f, text).filter((c) => c.text.length > 40);
  console.log(`${f}: ${cs.length} chunks`);
  all.push(...cs);
}
fs.writeFileSync(OUT, JSON.stringify({ built_at: new Date().toISOString(), count: all.length, chunks: all }, null, 1));
console.log(`OK: ${all.length} chunks -> ${OUT}`);

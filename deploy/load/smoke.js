#!/usr/bin/env node
// Smoke/carga stub — Fase 6 (sem deps: só `fetch` global do Node 20+).
// Portável p/ k6 depois (ver bloco K6_* no fim): mesma matriz de checagens.
//
// Alvos (docs/SLOs.md):
// - check-access p99 < 50ms (local, sem DB externo; com PG/Redis considerar SLO de staging)
// - webhook Asaas ack < 2s (só path de recepção: valida + persiste RECEIVED + 200)
// - /metrics contém as séries Fase 6
//
// Uso:
//   node deploy/load/smoke.js [--base http://localhost:3000] [--n 100] [--token ...]
//   SMOKE_TOKEN / SMOKE_ASAAS_SECRET via env quando quiser os checks autenticados.
// Checks sem credencial → SKIP (não falham o smoke).
//
// Saída: linhas PASS/SKIP/FAIL + resumo JSON; exit 0 se nenhum FAIL.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) {
      const k = cur.slice(2);
      const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1';
      acc.push([k, v]);
    }
    return acc;
  }, []),
);

const BASE = (args.base ?? process.env.SMOKE_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const N = Number(args.n ?? process.env.SMOKE_N ?? 100);
const TOKEN = args.token ?? process.env.SMOKE_TOKEN ?? null;
const ASAAS_SECRET = process.env.SMOKE_ASAAS_SECRET ?? null;

const REQUIRED_METRICS = [
  'http_requests_total',
  'http_request_duration_seconds',
  'outbox_lag_seconds',
  'bullmq_dlq_depth',
  'billing_recon_total',
  'finance_projection_total',
  'retention_runs_total',
];

const results = [];
function rec(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timedFetch(url, opts = {}) {
  const t0 = process.hrtime.bigint();
  const res = await fetch(url, opts);
  // drena o corpo para medir latência real fim-a-fim
  await res.arrayBuffer().catch(() => null);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { res, ms };
}

async function main() {
  // 1. Liveness
  try {
    const { res } = await timedFetch(`${BASE}/health/live`);
    rec('live', res.ok ? 'PASS' : 'FAIL', `HTTP ${res.status}`);
  } catch (e) {
    rec('live', 'FAIL', String(e?.message ?? e));
  }

  // 2. Readiness (pode ser 503 sem PG/Redis — reporta, não falha sozinho)
  try {
    const { res } = await timedFetch(`${BASE}/health/ready`);
    rec('ready', res.ok ? 'PASS' : 'SKIP', `HTTP ${res.status}`);
  } catch (e) {
    rec('ready', 'SKIP', String(e?.message ?? e));
  }

  // 3. /metrics contém séries Fase 6 (+ eco de correlationId)
  try {
    const cid = `smoke-${Date.now()}`;
    const { res, ms } = await timedFetch(`${BASE}/metrics`, { headers: { 'x-correlation-id': cid } });
    const body = await (await fetch(`${BASE}/metrics`)).text();
    const missing = REQUIRED_METRICS.filter((m) => !body.includes(m));
    const echo = res.headers.get('x-correlation-id');
    rec('metrics', res.ok && missing.length === 0 ? 'PASS' : 'FAIL', `${Math.round(ms)}ms; faltando=[${missing.join(',')}]`);
    rec('metrics-correlation-echo', echo === cid ? 'PASS' : 'FAIL', `eco=${echo ?? 'ausente'}`);
  } catch (e) {
    rec('metrics', 'FAIL', String(e?.message ?? e));
    rec('metrics-correlation-echo', 'FAIL', 'sem resposta');
  }

  // 4. check-access p99 (alvo < 50ms local). Sem token → mede /health/live como proxy e marca SKIP.
  try {
    const lat = [];
    if (TOKEN) {
      for (let i = 0; i < N; i++) {
        const { ms } = await timedFetch(`${BASE}/v1/access/check`, {
          headers: { authorization: `Bearer ${TOKEN}`, 'x-correlation-id': `smoke-acc-${i}` },
        });
        lat.push(ms);
      }
      lat.sort((a, b) => a - b);
      const p99 = pct(lat, 99);
      rec('check-access-p99', p99 < 50 ? 'PASS' : 'FAIL', `p99=${p99.toFixed(1)}ms alvo<50ms n=${N}`);
    } else {
      for (let i = 0; i < Math.min(N, 20); i++) {
        const { ms } = await timedFetch(`${BASE}/health/live`);
        lat.push(ms);
      }
      lat.sort((a, b) => a - b);
      rec('check-access-p99', 'SKIP', `sem SMOKE_TOKEN; proxy live p99=${pct(lat, 99).toFixed(1)}ms (medir com token em staging)`);
    }
  } catch (e) {
    rec('check-access-p99', 'FAIL', String(e?.message ?? e));
  }

  // 5. webhook ack < 2s (path de recepção). Sem segredo → SKIP.
  try {
    if (!ASAAS_SECRET) {
      rec('webhook-ack', 'SKIP', 'sem SMOKE_ASAAS_SECRET (alvo ack<2s só em staging)');
    } else {
      const payload = JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: `smoke_${Date.now()}` } });
      const { res, ms } = await timedFetch(`${BASE}/v1/billing/webhooks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-asaas-token': ASAAS_SECRET },
        body: payload,
      });
      rec('webhook-ack', res.status < 500 && ms < 2000 ? 'PASS' : 'FAIL', `HTTP ${res.status} ${Math.round(ms)}ms alvo<2s`);
    }
  } catch (e) {
    rec('webhook-ack', 'FAIL', String(e?.message ?? e));
  }

  const fails = results.filter((r) => r.status === 'FAIL').length;
  console.log(JSON.stringify({ base: BASE, n: N, pass: results.filter((r) => r.status === 'PASS').length, skip: results.filter((r) => r.status === 'SKIP').length, fail: fails }));
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FAIL smoke — ${e?.message ?? e}`);
  process.exit(1);
});

// K6_PORT (quando adotarmos k6 — mesma matriz):
// export const options = { vus: 20, duration: '1m', thresholds: {
//   'http_req_duration{route:check}': ['p(99)<50'],
//   'http_req_duration{route:webhook}': ['p(99)<2000'],
// }};

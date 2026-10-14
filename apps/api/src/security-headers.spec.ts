import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { parseAllowlist, securityHelmetOptions } from './common/http/security';
import { isSameOriginRequest } from './modules/auth/csrf';

// Fase 6 — Segurança final: headers presentes, CORS fail-closed, CSRF same-origin.
describe('Headers de segurança (helmet explícito)', () => {
  async function getHeaders(): Promise<Record<string, string>> {
    const app = express();
    app.use(helmet(securityHelmetOptions()));
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/ping').expect(200);
    return res.headers as Record<string, string>;
  }

  it('emite CSP restritiva + anti-clickjacking + nosniff + sem referrer', async () => {
    const h = await getHeaders();
    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['strict-transport-security']).toContain('max-age=31536000');
    expect(h['x-powered-by']).toBeUndefined();
  });
});

describe('CORS fail-closed (sem fallback *)', () => {
  const ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV };
  });

  it('ausente/vazio → nenhuma origem (deny all)', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist('')).toEqual([]);
    expect(parseAllowlist('   ')).toEqual([]);
  });

  it(' "*" é ignorado por padrão (fail-closed)', () => {
    expect(parseAllowlist('*')).toEqual([]);
    expect(parseAllowlist('https://app.example, *')).toEqual(['https://app.example']);
  });

  it('allowlist explícita passa intacta', () => {
    expect(parseAllowlist('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});

describe('CSRF — refresh via cookie exige same-origin', () => {
  it('sem Origin/Referer (curl/SDK/app) → permite', () => {
    expect(isSameOriginRequest({ headers: {}, host: 'api.example' })).toBe(true);
  });

  it('Origin mesma origem (com/sem porta, case-insensitive) → permite', () => {
    expect(
      isSameOriginRequest({ headers: { origin: 'https://api.example' }, host: 'api.example' }),
    ).toBe(true);
    expect(
      isSameOriginRequest({ headers: { origin: 'https://API.example:3000' }, host: 'api.example:3000' }),
    ).toBe(true);
  });

  it('Origin cruzada → nega', () => {
    expect(
      isSameOriginRequest({ headers: { origin: 'https://evil.test' }, host: 'api.example' }),
    ).toBe(false);
  });

  it('só Referer: mesma origem permite, cruzada nega', () => {
    expect(
      isSameOriginRequest({
        headers: { referer: 'https://api.example/login' },
        host: 'api.example',
      }),
    ).toBe(true);
    expect(
      isSameOriginRequest({
        headers: { referer: 'https://evil.test/x' },
        host: 'api.example',
      }),
    ).toBe(false);
  });

  it('Origin presente mas sem Host p/ comparar → nega (fail-closed)', () => {
    expect(isSameOriginRequest({ headers: { origin: 'https://api.example' } })).toBe(false);
  });
});

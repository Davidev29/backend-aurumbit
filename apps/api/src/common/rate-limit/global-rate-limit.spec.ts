import { HttpException } from '@nestjs/common';
import {
  GlobalRateLimitGuard,
  bucketKeyFor,
  matchRateLimitPreset,
  resetGlobalRateLimitBuckets,
} from './global-rate-limit.guard';

function ctx(url: string, opts: { headers?: Record<string, unknown>; body?: unknown; ip?: string }): any {
  const req: any = { url, headers: opts.headers ?? {}, body: opts.body };
  if (opts.ip) req.ip = opts.ip;
  return { switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader: () => undefined }) }) };
}

describe('rate-limit global por prefixo (Fase 6)', () => {
  beforeEach(() => resetGlobalRateLimitBuckets());

  it('roteia login/recovery/webhook/reveal; resto e /health/* = allow', () => {
    expect(matchRateLimitPreset('/v1/auth/login')).toBe('login');
    expect(matchRateLimitPreset('/v1/auth/refresh')).toBe('login');
    expect(matchRateLimitPreset('/v1/auth/forgot')).toBe('recovery');
    expect(matchRateLimitPreset('/v1/auth/reset')).toBe('recovery');
    expect(matchRateLimitPreset('/v1/billing/webhooks/asaas')).toBe('webhook');
    expect(matchRateLimitPreset('/webhooks/resend')).toBe('webhook');
    expect(matchRateLimitPreset('/v1/licenses/abc/reveal')).toBe('licenseReveal');
    expect(matchRateLimitPreset('/v1/licenses')).toBeNull();
    expect(matchRateLimitPreset('/health/ready')).toBeNull();
  });

  it('login/recovery compõem IP+identificador (nunca só IP)', () => {
    const a = bucketKeyFor('login', { headers: { 'x-forwarded-for': '1.2.3.4' }, body: { email: 'A@x.com' } });
    const b = bucketKeyFor('login', { headers: { 'x-forwarded-for': '1.2.3.4' }, body: { email: 'b@x.com' } });
    expect(a.key).not.toBe(b.key);
    expect(a.key).toContain('1.2.3.4');
  });

  it('429 após 5 logins/min na mesma chave (com identidade)', () => {
    const guard = new GlobalRateLimitGuard();
    const headers = { 'x-forwarded-for': '9.9.9.9' };
    const body = { email: 'brute@x.com' };
    for (let i = 0; i < 5; i++) {
      expect(guard.canActivate(ctx('/v1/auth/login', { headers, body }))).toBe(true);
    }
    let status = 0;
    try {
      guard.canActivate(ctx('/v1/auth/login', { headers, body }));
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      status = (e as HttpException).getStatus();
    }
    expect(status).toBe(429);
  });

  it('modo warn em teste: sem identidade (sem IP/identificador) → allow', () => {
    expect(process.env.NODE_ENV === 'test' || !process.env.NODE_ENV).toBe(true);
    const guard = new GlobalRateLimitGuard();
    for (let i = 0; i < 10; i++) {
      expect(guard.canActivate(ctx('/v1/auth/login', { headers: {}, body: {} }))).toBe(true);
    }
  });
});

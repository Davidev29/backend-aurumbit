// Executado via setupFiles do jest-e2e ANTES dos imports do spec,
// para que o env.schema fail-fast (ConfigModule validate) encontre as vars.
// Sem PG/Redis reais, /health/ready responde 503 — comportamento esperado e assertado no spec.
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/postgres';
process.env.REDIS_URL ??= 'redis://localhost:6379';
// Cadeia common/guards (Fase 2): segredo/iss/aud de teste — nunca produção.
process.env.JWT_SECRET ??= 'test-only-secret-min-16-chars';
process.env.JWT_ISS ??= 'aurum-bit';
process.env.JWT_AUD ??= 'aurum-clients';
// E-1 (T5-3): os specs e2e usam os repositórios em memória (`sessions.seed()`,
// `memberships.seed()`). Sem esta linha o GuardsModule cai no PgSessionLookup e
// a suíte quebra com "sessions.seed is not a function" (18 falhas medidas).
// Mesma convenção documentada em auth.module.ts e guards.module.ts.
process.env.AUTH_REPO ??= 'memory';

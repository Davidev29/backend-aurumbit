import { z } from 'zod';

// Schema fail-fast carregado via ConfigModule (validate). Throw = boot aborta.
// JWT_* (Fase 2, cadeia common/guards): defaults espelham `.env.example`.
//
// Banco consolidado (E2/E3): UM database `aurumbit`, 1 role por domínio via
// PgBouncer. As 9 DATABASE_URL_* são OBRIGATÓRIAS em produção e opcionais em
// dev/test (superRefine abaixo) — em dev os pools fazem fallback/disable
// quando ausentes. Leitores (FINANCE_REPORTS/AUDIT_READ) e MIGRATOR_DATABASE_URL
// são sempre opcionais: o migrator nunca é lido pelo app (só pelo one-shot).
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGINS: z.string().default('http://localhost:3001'),
    DATABASE_URL: z.string().url('DATABASE_URL deve ser uma URL Postgres válida'),
    REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatório'),
    // Bancos por domínio (pools PG leem `process.env` direto; o schema precisa
    // declarar p/ o ConfigModule repassar — zod remove chaves desconhecidas).
    DATABASE_URL_AUTH: z.string().url().optional(),
    DATABASE_URL_CUSTOMERS: z.string().url().optional(),
    DATABASE_URL_PRODUCTS: z.string().url().optional(),
    DATABASE_URL_ACCESS: z.string().url().optional(),
    DATABASE_URL_LICENSING: z.string().url().optional(),
    DATABASE_URL_BILLING: z.string().url().optional(),
    DATABASE_URL_FINANCE: z.string().url().optional(),
    DATABASE_URL_AUDIT: z.string().url().optional(),
    DATABASE_URL_COMMUNICATIONS: z.string().url().optional(),
    // Leitores só-SELECT (E2/E3): opcionais; ausentes = recursos que os usam
    // respondem degradado (mesmo padrão dos pools por domínio em dev).
    DATABASE_URL_FINANCE_REPORTS: z.string().url().optional(),
    DATABASE_URL_AUDIT_READ: z.string().url().optional(),
    // DDL dos 9 schemas (migrate one-shot, direto no Postgres, sem PgBouncer).
    // Opcional e NUNCA lido pelo app em runtime.
    MIGRATOR_DATABASE_URL: z.string().url().optional(),
    // Galeria da VPS (lida via `process.env` no serviço de imagens).
    PRODUCT_IMAGES_DIR: z.string().min(1).optional(),
    // Master key de licenças (E2/E3; E8 migra o uso): SÓ o caminho do arquivo
    // (ex. /run/secrets/license-master-key) — nunca o valor.
    // REMOVIDO (E8): LICENSE_KEY_ENC_KEY (valor direto) — não recriar.
    LICENSE_MASTER_KEY_PATH: z.string().min(1).optional(),
    LICENSE_MASTER_KEY_PREVIOUS_PATH: z.string().min(1).optional(),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter ao menos 16 chars').default('test-only-secret-min-16-chars'),
    JWT_ISS: z.string().min(1).default('aurum-bit'),
    JWT_AUD: z.string().min(1).default('aurum-clients'),
    // Fase 3 (opcionais; fallbacks documentados nos serviços):
    // OFFLINE_TOKEN_SECRET → JWT_SECRET; DEVICE_HMAC_SECRET → JWT_SECRET; IP_HASH_SALT → DEVICE_HMAC_SECRET.
    // TODO(KMS): segredos no KMS com rotação (device 90d+licença+12m, ip salt 90d).
    OFFLINE_TOKEN_SECRET: z.string().min(16).optional(),
    DEVICE_HMAC_SECRET: z.string().min(16).optional(),
    IP_HASH_SALT: z.string().min(8).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((val, ctx) => {
    // Em produção cada domínio exige seu role dedicado (fail-closed: sem URL
    // por domínio, o boot aborta em vez de subir com pool errado).
    if (val.NODE_ENV !== 'production') return;
    const required = [
      'DATABASE_URL_AUTH',
      'DATABASE_URL_CUSTOMERS',
      'DATABASE_URL_PRODUCTS',
      'DATABASE_URL_ACCESS',
      'DATABASE_URL_LICENSING',
      'DATABASE_URL_BILLING',
      'DATABASE_URL_FINANCE',
      'DATABASE_URL_AUDIT',
      'DATABASE_URL_COMMUNICATIONS',
    ] as const;
    for (const key of required) {
      if (!val[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} é obrigatória em produção (E2/E3: role dedicada via PgBouncer)`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Env inválida (fail-fast): ${details}`);
  }
  return parsed.data;
}

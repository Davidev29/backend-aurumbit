import { z } from 'zod';

// Schema fail-fast carregado via ConfigModule (validate). Throw = boot aborta.
// JWT_* (Fase 2, cadeia common/guards): defaults espelham `.env.example`.
const envSchema = z.object({
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
  // Galeria da VPS (lida via `process.env` no serviço de imagens).
  PRODUCT_IMAGES_DIR: z.string().min(1).optional(),
  // Cifra de reemissão (lida via `process.env` em license-keys.ts).
  // Opcional e SEM mínimo: string vazia (ex. compose sem segredo) equivale a
  // ausente — o serviço nega o reveal com 409 honesto em vez de travar o boot.
  LICENSE_KEY_ENC_KEY: z.string().max(128).optional(),
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

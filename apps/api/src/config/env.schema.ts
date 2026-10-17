import { z } from 'zod';

// Schema fail-fast carregado via ConfigModule (validate). Throw = boot aborta.
// JWT_* (Fase 2, cadeia common/guards): defaults espelham `.env.example`.
//
// Banco consolidado (E2/E3): UM database `aurumbit`, 1 role por domínio via
// PgBouncer. As 9 DATABASE_URL_* são OBRIGATÓRIAS em produção e opcionais em
// dev/test (superRefine abaixo) — em dev os pools fazem fallback/disable
// quando ausentes. Leitores (FINANCE_REPORTS/AUDIT_READ) e MIGRATOR_DATABASE_URL
// são sempre opcionais: o migrator nunca é lido pelo app (só pelo one-shot).
/**
 * D2-4: segredos PLACEHOLDER não podem virar segredo real.
 *
 * O bug: `.env.example` traz `JWT_SECRET=TROCAR_JWT_SECRET_GERADO_MIN_32_BYTES`
 * — 39 chars, passa `min(16)`, e era aceito como segredo de verdade. Copiar o
 * example e subir com `NODE_ENV=production` publicava a API com um segredo que
 * está no repositório. O fail-fast existente (`jwt.service.ts`) só rejeita a
 * string default de TESTE, não placeholders.
 *
 * A checagem vale em TODO ambiente (dev included): o `.env` de desenvolvimento
 * da repo tem um segredo real (64 hex) e segue válido — a rejeição aqui é
 * justamente para pegar o copy-paste do example cedo.
 */
const SECRET_PLACEHOLDERS: RegExp[] = [
  /^trocar/i,
  /^change[-_ ]?me/i,
  /^changeme/i,
  /^placeholder/i,
  /^replace[-_ ]?me/i,
  /^gerar[-_ ]/i,
  /^example/i,
  /^seu[-_ ]?segredo/i,
  /^xxx/i,
  /^\$\{.*\}$/, // valor não interpolado
  /^<.*>$/,
];

/** Defaults de teste (não são segredo): aceitos em qualquer ambiente. */
const TEST_ONLY_SECRETS = new Set(['test-only-secret-min-16-chars']);

/** Fallback hardcoded de `auth.module.ts` — nunca pode chegar em produção. */
const DEV_ONLY_FALLBACK = 'dev-only-insecure-secret';

const SECRET_KEYS = ['JWT_SECRET', 'AUTH_JWT_SECRET', 'MFA_ENC_KEY', 'MFA_ENC_KEY_PREVIOUS'] as const;

function isRealSecret(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s.length === 0) return false;
  if (TEST_ONLY_SECRETS.has(s)) return true;
  return !SECRET_PLACEHOLDERS.some((re) => re.test(s));
}

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
    // Auth (Fase 2). `AUTH_JWT_SECRET` tem PRECEDÊNCIA sobre `JWT_SECRET` no
    // AuthService e não era validado por nada (fora do schema) — declarado aqui
    // com o mesmo piso de tamanho e com fail-fast de DIVERGÊNCIA no
    // `superRefine` (bloco antes do gate de produção). `MFA_ENC_KEY` é a
    // chave DEDICADA do segredo
    // TOTP (D2-3): obrigatória em produção (fail-fast no `superRefine` abaixo e
    // em `assertMfaEncKeyConfig`). `MFA_ENC_KEY_PREVIOUS` (lista separada por
    // vírgula) permite rotacionar sem quebrar o MFA já emitido — mesmo padrão de
    // `LICENSE_MASTER_KEY_PREVIOUS_PATH`.
    AUTH_JWT_SECRET: z.string().min(16, 'AUTH_JWT_SECRET deve ter ao menos 16 chars').optional(),
    MFA_ENC_KEY: z.string().min(32, 'MFA_ENC_KEY deve ter ao menos 32 chars').optional(),
    MFA_ENC_KEY_PREVIOUS: z.string().min(1).optional(),
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
    // Swagger UI (docs/openapi.yaml). Default por env: ligado fora de produção;
    // em produção só com SWAGGER_ENABLED=true (ver common/openapi/swagger.ts).
    SWAGGER_ENABLED: z
      .string()
      .optional()
      .transform((v) => v?.trim().toLowerCase())
      .refine((v) => v === undefined || ['true', 'false', '0', '1'].includes(v), {
        message: 'SWAGGER_ENABLED deve ser true|false|1|0',
      }),
    SWAGGER_PATH: z.string().min(1).optional(),
    OPENAPI_SPEC_PATH: z.string().min(1).optional(),
    // Driver das filas BullMQ da API (achado N1). `memory` (default) = fila
    // in-memory e nada vai ao Redis (o boot registra o driver em produção como
    // ERROR); `bullmq` = Queue real, exige Redis de pé. Ligar junto com o
    // wiring dos workers (decisão D-B: "não ativar o pipeline").
    QUEUE_DRIVER: z
      .string()
      .optional()
      .transform((v) => v?.trim().toLowerCase())
      .refine((v) => v === undefined || ['memory', 'bullmq'].includes(v), {
        message: 'QUEUE_DRIVER deve ser memory|bullmq',
      }),
  })
  .superRefine((val, ctx) => {
    // Placeholders rejeitados em qualquer ambiente (D2-4). O default de teste
    // está na whitelist, então `setup-e2e.ts`/e2e seguem funcionando.
    for (const key of SECRET_KEYS) {
      const v = val[key];
      if (v === undefined || isRealSecret(v)) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} é placeholder/valor de exemplo — gere um segredo real (ex.: \`openssl rand -hex 32\`) e nunca versione o valor.`,
      });
    }
    // AUTH_JWT_SECRET divergente de JWT_SECRET = sessão INTEIRA morta (401 em
    // toda request autenticada) e o boot passa: o `AuthService` EMITE com
    // `AUTH_JWT_SECRET` (tem precedência, `auth.service.ts:91`) enquanto o
    // `JwtAuthGuard` VALIDA só com `JWT_SECRET` (`jwt.service.ts:28`, que nunca
    // lê `AUTH_JWT_SECRET`) => `TOKEN_SIGNATURE` em tudo. Como declarar
    // `AUTH_JWT_SECRET` no schema (D2-4) convida o operador a configurá-lo, o
    // fail-fast é aqui: enquanto o `jwt.service.ts` não resolver a mesma
    // precedência, os dois segredos precisam ser IGUAIS (ou o segundo ausente).
    // Vale em TODO ambiente — a armadilha é a mesma; o `.env` de dev e o
    // `setup-e2e.ts` não definem `AUTH_JWT_SECRET`, então nada muda neles.
    // A comparação usa o valor JÁ resolvido do schema: sem `JWT_SECRET`, o
    // default é exatamente o que o `jwt.service.ts` verifica.
    if (val.AUTH_JWT_SECRET && val.AUTH_JWT_SECRET !== val.JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_JWT_SECRET'],
        message:
          'AUTH_JWT_SECRET divergente de JWT_SECRET: o AuthService assina com AUTH_JWT_SECRET (precedência) e o JwtAuthGuard valida só com JWT_SECRET — todo token emitido é rejeitado (401 em toda request). Remova AUTH_JWT_SECRET ou defina-o com o MESMO valor de JWT_SECRET enquanto o jwt.service.ts não ler AUTH_JWT_SECRET.',
      });
    }
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
    // D2-3(a): chave dedicada do segredo TOTP é obrigatória em produção. Sem
    // ela o segredo de todo usuário seria cifrado com o segredo JWT e a
    // rotação (rotina) do JWT derrubaria o MFA de todos.
    if (!val.MFA_ENC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MFA_ENC_KEY'],
        message:
          'MFA_ENC_KEY é obrigatória em produção (chave dedicada do segredo TOTP; derivar de JWT_SECRET quebra MFA na rotação). Gere com `openssl rand -hex 32`.',
      });
    }
    // O fallback hardcoded do código (`auth.module.ts`) nunca pode chegar em prod.
    for (const key of ['JWT_SECRET', 'AUTH_JWT_SECRET'] as const) {
      if (val[key] === DEV_ONLY_FALLBACK) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} está com o fallback dev-only do código — gere um segredo real.`,
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

/**
 * Config do Asaas (Fase 4, PROJECT.md §5 + REQUIREMENTS.md §3).
 * - Sandbox-first: default `https://sandbox.asaas.com/api/v3` (nunca
 *   aponte p/ produção sem trocar `ASAAS_API_URL` explicitamente).
 * - Segredos SEMPRE via env (`ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`).
 *   NUNCA hardcode. TODO(KMS): migrar p/ KMS com rotação (mesmo TODO do
 *   `env.schema.ts` p/ `OFFLINE_TOKEN_SECRET`/`DEVICE_HMAC_SECRET`).
 */

export const ASAAS_SANDBOX_BASE_URL = 'https://sandbox.asaas.com/api/v3';

export interface AsaasConfig {
  /** Base da API v3. Default: Sandbox. */
  baseUrl: string;
  /** `access_token` do Asaas (env `ASAAS_API_KEY`). Nunca logar. */
  apiKey: string;
  /** Timeout por tentativa em ms (default 8000 — folga p/ ack <2s do webhook, que nunca chama o Asaas no request path). */
  timeoutMs: number;
  /** Segredo do webhook (`ASAAS_WEBHOOK_SECRET`), validado via `asaas-access-token` timing-safe no controller. */
  webhookSecret: string | null;
}

function str(env: NodeJS.ProcessEnv, key: string): string | null {
  const v = env[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Lê config do env. Fail-fast SÓ na chave (sem chave o adapter nem
 * instancia — boot aborta com mensagem acionável). `baseUrl` sempre
 * HTTPS; `changeme`/vazio na chave = erro (evita subir com placeholder).
 */
// TODO(KMS): `apiKey`/`webhookSecret` via KMS (cache em memória + rotação),
// mantendo esta função como ponto único de leitura.
export function loadAsaasConfig(env: NodeJS.ProcessEnv = process.env): AsaasConfig {
  const baseUrl = str(env, 'ASAAS_API_URL') ?? ASAAS_SANDBOX_BASE_URL;
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error(`ASAAS_API_URL deve ser HTTPS (recebido: ${baseUrl.slice(0, 48)})`);
  }
  const apiKey = str(env, 'ASAAS_API_KEY');
  if (!apiKey || apiKey === 'changeme') {
    throw new Error('ASAAS_API_KEY ausente (fail-fast): defina no env; nunca hardcode.');
  }
  const timeoutRaw = str(env, 'ASAAS_TIMEOUT_MS');
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 8000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new Error('ASAAS_TIMEOUT_MS deve ser 1..30000');
  }
  const webhookSecret = str(env, 'ASAAS_WEBHOOK_SECRET');
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, timeoutMs, webhookSecret };
}

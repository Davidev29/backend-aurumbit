import { ServiceUnavailableException } from '@nestjs/common';

// Porta mínima do provider p/ automação financeira.
// Implementação default fala Asaas API v3 direto (sandbox-first), sem
// importar `libs/asaas-adapter` (evita acoplamento de build api↔libs):
// o contrato (retry 1x só transitório, 4xx nunca retenta, erros sem chave)
// espelha `AsaasProviderAdapter`. Testes injetam fakes por este token.

export interface FinanceAutomationProvider {
  createBillPayment(input: {
    identificationField: string;
    scheduleDate?: string;
    description?: string;
    externalReference?: string;
  }): Promise<{ id: string; status: string; scheduleDate?: string | null }>;
  createCharge(input: {
    customerId: string;
    valueCents: number;
    dueDate: string;
    billingType?: string;
    description?: string;
    externalReference?: string;
  }): Promise<{ id: string; status: string }>;
  getChargeIdentificationField(
    paymentId: string,
  ): Promise<{ identificationField: string | null; barCode: string | null; nossoNumero: string | null }>;
}

export const FINANCE_AUTOMATION_PROVIDER = 'FINANCE_AUTOMATION_PROVIDER';

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function asaasEnv(): { baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.ASAAS_API_URL ?? 'https://sandbox.asaas.com/api/v3').replace(/\/$/, '');
  if (!/^https:\/\//.test(baseUrl)) throw new Error('ASAAS_API_URL deve ser HTTPS');
  const apiKey = process.env.ASAAS_API_KEY ?? '';
  if (!apiKey || apiKey === 'changeme') {
    throw new ServiceUnavailableException(
      'pagamento via Asaas indisponível (ASAAS_API_KEY não configurado; siga manual)',
    );
  }
  return { baseUrl, apiKey };
}

async function asaasRequest<T>(method: string, path: string, payload?: unknown): Promise<T> {
  const { baseUrl, apiKey } = asaasEnv();
  const timeoutMs = Number(process.env.ASAAS_TIMEOUT_MS ?? 8000);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { access_token: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000),
      });
      if (res.ok) return (await res.json()) as T;
      if (!RETRYABLE.has(res.status) || attempt === 1) {
        throw new Error(`Asaas ${method} ${path} → HTTP ${res.status}`);
      }
      lastErr = new Error(`Asaas ${method} ${path} → HTTP ${res.status} (retry)`);
    } catch (e) {
      lastErr = e;
      if (attempt === 1) break;
      // Rede/timeout: retry 1x. Erro final sanitizado (sem chave).
      if (e instanceof Error && /^Asaas .* HTTP/.test(e.message) && !RETRYABLE.has(Number((e.message.match(/HTTP (\d+)/) ?? [])[1] ?? 0))) {
        throw e;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Asaas ${method} ${path} falhou`);
}

/** Provider real (lazy por chamada: boot nunca aborta sem ASAAS_API_KEY). */
export function createFinanceAutomationProvider(): FinanceAutomationProvider {
  return {
    async createBillPayment(input) {
      const body = await asaasRequest<Record<string, unknown>>('POST', '/billPayments', {
        identificationField: input.identificationField,
        scheduleDate: input.scheduleDate ?? undefined,
        description: input.description ?? undefined,
        externalReference: input.externalReference ?? undefined,
      });
      return {
        id: String(body.id),
        status: String(body.status ?? 'SCHEDULED'),
        scheduleDate: (body.scheduleDate as string) ?? input.scheduleDate ?? null,
      };
    },
    async createCharge(input) {
      const body = await asaasRequest<Record<string, unknown>>('POST', '/payments', {
        customer: input.customerId,
        billingType: input.billingType ?? 'UNDEFINED',
        value: input.valueCents / 100,
        dueDate: input.dueDate,
        description: input.description ?? undefined,
        externalReference: input.externalReference ?? undefined,
      });
      return { id: String(body.id), status: String(body.status ?? 'PENDING') };
    },
    async getChargeIdentificationField(paymentId) {
      const body = await asaasRequest<Record<string, unknown>>(
        'GET',
        `/payments/${encodeURIComponent(paymentId)}/identificationField`,
      );
      const field = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
      return {
        identificationField: field(body.identificationField),
        barCode: field(body.barCode ?? body.barcode),
        nossoNumero: body.nossoNumero != null ? String(body.nossoNumero) : null,
      };
    },
  };
}

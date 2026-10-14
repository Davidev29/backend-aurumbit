/**
 * `AsaasProviderAdapter` — implementação `BillingProviderPort` sobre o
 * Asaas API v3, Sandbox-first (`https://sandbox.asaas.com/api/v3`).
 * - Auth: header `access_token: <ASAAS_API_KEY>` (nunca em query/log).
 * - Timeout por tentativa (`ASAAS_TIMEOUT_MS`, default 8000) + retry 1x
 *   (2 tentativas no total) SÓ em falha transitória (rede/timeout/429/5xx).
 *   4xx (exceto 429) nunca retenta.
 * - Erros sanitizados: mensagens NUNCA contêm a chave.
 * Sem dependências externas (fetch global, Node >= 20).
 */

import { AsaasConfig, loadAsaasConfig } from './config';
import { BillPayment, BillPaymentInput } from './bill-payments';
import {
  BillingCharge,
  BillingChargeInput,
  BillingCustomer,
  BillingCustomerInput,
  BillingPaymentStatus,
  BillingProviderPort,
  BillingSubscription,
  BillingSubscriptionInput,
  ListPaymentsParams,
  ListPaymentsResult,
} from './port';

const MAX_ATTEMPTS = 2; // 1 tentativa + retry 1x
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Pura/testável: decide retry por status HTTP (rede/timeout = null). */
export function shouldRetry(status: number | null, attempt: number): boolean {
  if (attempt + 1 >= MAX_ATTEMPTS) return false;
  if (status === null) return true; // erro de rede/timeout/abort
  return RETRYABLE_STATUS.has(status);
}

export class AsaasError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly attempt: number,
  ) {
    super(message);
    this.name = 'AsaasError';
  }
}

type FetchFn = typeof fetch;

export class AsaasProviderAdapter implements BillingProviderPort {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly config: AsaasConfig,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  /** Atalho fail-fast a partir do env (TODO KMS — ver `config.ts`). */
  static fromEnv(fetchFn?: FetchFn): AsaasProviderAdapter {
    return new AsaasProviderAdapter(loadAsaasConfig(), fetchFn);
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async createCustomer(input: BillingCustomerInput): Promise<BillingCustomer> {
    const body = await this.request<Record<string, unknown>>('POST', '/customers', {
      name: input.name,
      email: input.email ?? undefined,
      cpfCnpj: input.cpfCnpj ?? undefined,
      externalReference: input.externalReference ?? undefined,
    });
    return {
      id: String(body.id),
      name: String(body.name ?? input.name),
      email: (body.email as string) ?? null,
    };
  }

  async createCharge(input: BillingChargeInput): Promise<BillingCharge> {
    const body = await this.request<Record<string, unknown>>('POST', '/payments', {
      customer: input.customerId,
      billingType: input.billingType ?? 'UNDEFINED',
      value: input.valueCents / 100,
      dueDate: input.dueDate,
      description: input.description ?? undefined,
      externalReference: input.externalReference ?? undefined,
    });
    return {
      id: String(body.id),
      status: String(body.status ?? 'PENDING'),
      valueCents: Math.round(Number(body.value ?? input.valueCents / 100) * 100),
      dueDate: (body.dueDate as string) ?? null,
    };
  }

  async createSubscription(input: BillingSubscriptionInput): Promise<BillingSubscription> {
    const body = await this.request<Record<string, unknown>>('POST', '/subscriptions', {
      customer: input.customerId,
      billingType: input.billingType ?? 'UNDEFINED',
      value: input.valueCents / 100,
      nextDueDate: input.nextDueDate,
      cycle: input.cycle ?? 'MONTHLY',
      description: input.description ?? undefined,
      externalReference: input.externalReference ?? undefined,
    });
    return { id: String(body.id), status: String(body.status ?? 'ACTIVE') };
  }

  async cancelSubscription(subscriptionId: string): Promise<{ id: string; status: string }> {
    const body = await this.request<Record<string, unknown>>(
      'DELETE',
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
    return { id: String(body.id ?? subscriptionId), status: String(body.status ?? 'CANCELLED') };
  }

  async refundCharge(
    paymentId: string,
    valueCents?: number,
  ): Promise<{ id: string; status: string }> {
    const body = await this.request<Record<string, unknown>>(
      'POST',
      `/payments/${encodeURIComponent(paymentId)}/refund`,
      valueCents != null ? { value: valueCents / 100 } : {},
    );
    return { id: String(body.id ?? paymentId), status: String(body.status ?? 'REFUNDED') };
  }

  async getPaymentStatus(paymentId: string): Promise<BillingPaymentStatus> {
    const body = await this.request<Record<string, unknown>>(
      'GET',
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    return {
      id: String(body.id ?? paymentId),
      status: String(body.status ?? 'UNKNOWN'),
      valueCents: Math.round(Number(body.value ?? 0) * 100),
    };
  }

  /**
   * Linha digitável + código de barras da cobrança (recebível automático).
   * `GET /v3/payments/{id}/identificationField` → `{ identificationField, barCode, nossoNumero }`.
   */
  async getChargeIdentificationField(
    paymentId: string,
  ): Promise<{ identificationField: string | null; barCode: string | null; nossoNumero: string | null }> {
    const body = await this.request<Record<string, unknown>>(
      'GET',
      `/payments/${encodeURIComponent(paymentId)}/identificationField`,
    );
    const field = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
    return {
      identificationField: field(body.identificationField),
      barCode: field(body.barCode ?? body.barcode),
      nossoNumero: body.nossoNumero != null ? String(body.nossoNumero) : null,
    };
  }

  /**
   * Paga conta externa (boleto/convênio) via Conta Asaas — Bill Payments.
   * `POST /v3/billPayments` com `{ identificationField, scheduleDate?, description?, externalReference? }`.
   * Vencido não agenda (Asaas paga na hora); sandbox-first com retry só
   * transitório — mesmo contrato do `request` (4xx nunca retenta).
   */
  async createBillPayment(input: BillPaymentInput): Promise<BillPayment> {
    const body = await this.request<Record<string, unknown>>('POST', '/billPayments', {
      identificationField: input.identificationField,
      scheduleDate: input.scheduleDate ?? undefined,
      description: input.description ?? undefined,
      externalReference: input.externalReference ?? undefined,
    });
    return {
      id: String(body.id),
      status: String(body.status ?? 'SCHEDULED'),
      valueCents:
        body.value != null ? Math.round(Number(body.value) * 100) : undefined,
      dueDate: (body.dueDate as string) ?? null,
      scheduleDate: (body.scheduleDate as string) ?? input.scheduleDate ?? null,
    };
  }

  async getBillPayment(billId: string): Promise<BillPayment> {
    const body = await this.request<Record<string, unknown>>(
      'GET',
      `/billPayments/${encodeURIComponent(billId)}`,
    );
    return {
      id: String(body.id ?? billId),
      status: String(body.status ?? 'UNKNOWN'),
      valueCents: body.value != null ? Math.round(Number(body.value) * 100) : undefined,
      dueDate: (body.dueDate as string) ?? null,
      scheduleDate: (body.scheduleDate as string) ?? null,
    };
  }

  async cancelBillPayment(billId: string): Promise<{ id: string; status: string }> {
    const body = await this.request<Record<string, unknown>>(
      'DELETE',
      `/billPayments/${encodeURIComponent(billId)}`,
    );
    return { id: String(body.id ?? billId), status: String(body.status ?? 'CANCELLED') };
  }

  async listPayments(params: ListPaymentsParams = {}): Promise<ListPaymentsResult> {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 100);
    const offset = Math.max(params.offset ?? 0, 0);
    const qs = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (params.status) qs.set('status', params.status);
    const body = await this.request<{
      data?: Array<Record<string, unknown>>;
      hasMore?: boolean;
      totalCount?: number;
    }>('GET', `/payments?${qs.toString()}`);
    const data = (body.data ?? []).map((p) => ({
      id: String(p.id),
      status: String(p.status ?? 'UNKNOWN'),
      valueCents: Math.round(Number(p.value ?? 0) * 100),
    }));
    return { data, hasMore: body.hasMore ?? data.length === limit, totalCount: body.totalCount };
  }

  private async request<T>(method: string, path: string, payload?: unknown): Promise<T> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.fetchFn(`${this.config.baseUrl}${path}`, {
          method,
          headers: {
            // Asaas v3 autentica via header `access_token` (nunca query/log).
            access_token: this.config.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        if (res.ok) return (await res.json()) as T;
        if (!shouldRetry(res.status, attempt)) {
          throw new AsaasError(
            `Asaas ${method} ${path} → HTTP ${res.status}`,
            res.status,
            attempt + 1,
          );
        }
        lastErr = new AsaasError(
          `Asaas ${method} ${path} → HTTP ${res.status} (retry)`,
          res.status,
          attempt + 1,
        );
      } catch (e) {
        if (e instanceof AsaasError) {
          if (!shouldRetry(e.status, attempt)) throw e;
          lastErr = e;
        } else {
          // Rede/timeout/abort — retry 1x; mensagem sanitizada (sem chave/URL com segredo).
          if (!shouldRetry(null, attempt)) {
            throw new AsaasError(
              `Asaas ${method} ${path} falhou (rede/timeout)`,
              null,
              attempt + 1,
            );
          }
          lastErr = e;
        }
      }
    }
    if (lastErr instanceof AsaasError) throw lastErr;
    throw new AsaasError(
      `Asaas ${method} ${path} falhou após ${MAX_ATTEMPTS} tentativas`,
      null,
      MAX_ATTEMPTS,
    );
  }
}

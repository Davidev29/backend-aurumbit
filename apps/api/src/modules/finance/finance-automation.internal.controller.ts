// Endpoints internos worker→API da automação financeira.
// `POST /v1/finance/internal/automation/bill-pay` e `.../auto-charge`
// (internos, `@Public()` + `x-internal-key`): reexecutam o job pela
// idempotencyKey (payload sensível — barcode/customer — viaja no job-data
// do BullMQ, efêmero; no PG guardamos só máscara).
// Idempotente: DONE/SCHEDULED/CANCELED → 200 `{ duplicate: true }`
// (nunca 409 — dedupe é o caminho esperado, PROJECT.md §5).
// 400 = poison (DLQ direto, sem retry); 5xx/rede = retry exponencial.

import { BadRequestException, Body, Controller, HttpCode, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { FinanceAutomationService } from './finance-automation.service';

function checkInternalKey(req: unknown): void {
  const expected = process.env.INTERNAL_WEBHOOK_KEY ?? null;
  if (!expected) {
    throw new ServiceUnavailableException(
      'automação interna indisponível (INTERNAL_WEBHOOK_KEY não configurado)',
    );
  }
  const headers = (req as { headers?: Record<string, unknown> }).headers ?? {};
  const got = headers['x-internal-key'];
  const gotStr = Array.isArray(got) ? got[0] : got;
  if (typeof gotStr !== 'string' || gotStr !== expected) {
    throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Chave interna inválida.' });
  }
}

interface BillPayReplayBody {
  orgId?: string;
  idempotencyKey?: string;
  barcode?: string;
  scheduleDate?: string;
  description?: string;
}

interface AutoChargeReplayBody {
  orgId?: string;
  idempotencyKey?: string;
  asaasCustomerId?: string;
  customerName?: string;
  amountCents?: number;
  dueDate?: string;
  billingType?: string;
  description?: string;
}

@Public()
@Controller('finance/internal/automation')
export class FinanceAutomationInternalController {
  constructor(private readonly automation: FinanceAutomationService) {}

  @Post('bill-pay')
  @HttpCode(200)
  async replayBillPay(@Req() req: unknown, @Body() body: BillPayReplayBody): Promise<unknown> {
    checkInternalKey(req);
    const orgId = typeof body?.orgId === 'string' ? body.orgId : '';
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '';
    if (!orgId || !idempotencyKey) {
      throw new BadRequestException('orgId + idempotencyKey obrigatórios');
    }
    return this.automation.replayBillPay(orgId, {
      idempotencyKey,
      barcode: body.barcode,
      scheduleDate: body.scheduleDate,
      description: body.description,
    });
  }

  @Post('auto-charge')
  @HttpCode(200)
  async replayAutoCharge(@Req() req: unknown, @Body() body: AutoChargeReplayBody): Promise<unknown> {
    checkInternalKey(req);
    const orgId = typeof body?.orgId === 'string' ? body.orgId : '';
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '';
    if (!orgId || !idempotencyKey) {
      throw new BadRequestException('orgId + idempotencyKey obrigatórios');
    }
    return this.automation.replayAutoCharge(orgId, {
      idempotencyKey,
      asaasCustomerId: body.asaasCustomerId,
      customerName: body.customerName,
      amountCents: typeof body.amountCents === 'number' ? body.amountCents : undefined,
      dueDate: body.dueDate,
      billingType: body.billingType,
      description: body.description,
    });
  }
}

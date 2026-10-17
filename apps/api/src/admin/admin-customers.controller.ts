import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CustomerPipelineService } from '../modules/customers/customer-pipeline.service';
import type { CustomerStage } from '../modules/customers/customer-pipeline.service';
import { StaffGuard } from '../common/guards/staff.guard';

// Fase 6+ (aditivo): funil de clientes para o admin.
// `GET /v1/admin/customers` → pipeline prospect → cliente.
//
// Exige staff de verdade (`StaffGuard`): role `STAFF_*` no JWT ou e-mail na
// allowlist `ADMIN_STAFF_EMAILS`. NUNCA confiar só em `x-role: admin` — essa
// rota devolve PII (e-mail dos titulares) e qualquer cliente do portal tem JWT
// válido, então o header stub abriria a lista para o público do portal.
@Controller('admin/customers')
@UseGuards(StaffGuard)
export class AdminCustomersController {
  constructor(private readonly pipeline: CustomerPipelineService) {}

  /**
   * `?q=` busca nome/e-mail · `?stage=` filtra o funil · `?cursor=` página.
   * `syncIdentities` roda dentro de `list`, então um cadastro recém-enviado
   * já aparece como PROSPECT sem nenhum passo manual.
   */
  @Get()
  list(
    @Query('q') q?: string,
    @Query('stage') stage?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    return this.pipeline.list({
      q: q ?? null,
      stage: isStage(stage) ? stage : null,
      cursor: cursor ?? null,
      limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
    });
  }

  /** Cards de topo: quantos prospects x clientes x suspensos. */
  @Get('summary')
  summary() {
    return this.pipeline.countByStage();
  }
}

const STAGES: readonly CustomerStage[] = ['PROSPECT', 'PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'CANCELLED'];

function isStage(value: string | undefined): value is CustomerStage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditReadService } from './audit-read.service';
import { ListAuditEventsQueryDto } from './audit-query.dto';

// Domínio audit. Leitura PG (aditiva):
// `GET /v1/audit/events` — trilha append-only (só SELECT, sem UPDATE/DELETE).
// Requer role `STAFF_ADMIN` no JWT; escritas futuras exigirão MFA step-up.
// Escreve NOBODY hoje (workstreams futuros emitem p/ cá); vazio honesto.
@Controller('audit')
@UseGuards(RolesGuard)
export class AuditController {
  constructor(private readonly reader: AuditReadService) {}

  @Get('events')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  events(@Query() q: ListAuditEventsQueryDto) {
    return this.reader.listEvents({
      actor: q.actor,
      resource: q.resource,
      correlationId: q.correlationId,
      from: q.from,
      to: q.to,
      limit: q.limit,
      cursor: q.cursor,
    });
  }
}

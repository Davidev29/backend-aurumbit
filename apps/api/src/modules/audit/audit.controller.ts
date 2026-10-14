import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminStubGuard } from '../access/admin.guard';
import { AuditReadService } from './audit-read.service';
import { ListAuditEventsQueryDto } from './audit-query.dto';

// TODO(Fase 2): endpoints do domínio audit. Leitura PG (aditiva):
// `GET /v1/audit/events` — trilha append-only (só SELECT, sem UPDATE/DELETE).
// Escreve NOBODY hoje (workstreams futuros emitem p/ cá); vazio honesto.
@Controller('audit')
export class AuditController {
  constructor(private readonly reader: AuditReadService) {}

  @Get('events')
  @UseGuards(AdminStubGuard)
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

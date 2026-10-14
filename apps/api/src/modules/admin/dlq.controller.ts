import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DlqAdminGuard } from './dlq-admin.guard';
import { dlqStore, normalizeDlqQueue } from './dlq-store';

// Superfície admin da DLQ (Fase 6, aditiva — nenhum domínio tocado).
// - `GET /v1/admin/dlq?queue=&page=&pageSize=` — paginado (máx 100/página).
// - `POST /v1/admin/dlq/:queue/replay` — `{ jobId? }` (ou `{ eventId? }`);
//   sem identificador replays o lote pendente da fila (até 100).
// Ambas exigem admin + MFA stub (`DlqAdminGuard`) e emitem trilha audit
// (`dlq.list` / `dlq.replay`, sem PII — só fila/jobId/eventId/contadores).

function actorOf(req: unknown): string {
  const h = (req as { headers?: Record<string, unknown> }).headers ?? {};
  for (const k of ['x-actor-id', 'x-subject-id']) {
    const v = h[k];
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 128);
  }
  if (typeof h['x-service-token'] === 'string' && (h['x-service-token'] as string).length > 0) return 'system';
  return `role:${String(h['x-role'] ?? 'unknown').slice(0, 32)}`;
}

@Controller('admin/dlq')
@UseGuards(DlqAdminGuard)
export class DlqAdminController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('queue') queue: string | undefined,
    @Query('page') pageRaw: string | undefined,
    @Query('pageSize') pageSizeRaw: string | undefined,
    @Req() req: unknown,
  ) {
    const page = pageRaw ? Number(pageRaw) : 1;
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : 20;
    const out = dlqStore.list({
      queue: queue ? String(queue) : undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });
    this.audit.emit({
      actorId: actorOf(req),
      action: 'dlq.list',
      entity: 'dlq',
      metadata: {
        queue: queue ? normalizeDlqQueue(String(queue)) : 'all',
        page: out.page,
        pageSize: out.pageSize,
        count: out.total,
      },
    });
    return { ...out, queue: queue ? normalizeDlqQueue(String(queue)) : undefined };
  }

  @Post(':queue/replay')
  replay(
    @Param('queue') queue: string,
    @Body() body: { jobId?: string; eventId?: string; limit?: number } | undefined,
    @Req() req: unknown,
  ) {
    const q = normalizeDlqQueue(String(queue ?? ''));
    const jobId =
      typeof body?.jobId === 'string' && body.jobId.length > 0
        ? body.jobId
        : typeof body?.eventId === 'string' && body.eventId.length > 0
          ? body.eventId
          : undefined;
    const limit =
      typeof body?.limit === 'number' && Number.isFinite(body.limit)
        ? Math.max(1, Math.min(1000, Math.floor(body.limit)))
        : 100;
    const results = dlqStore.replay(q, jobId, limit);
    const replayed = results.filter((r) => !r.duplicate).length;
    const duplicates = results.filter((r) => r.duplicate).length;
    // TODO(Fase 6-hardening): re-enqueue real na fila de origem
    // (`new Queue(origem).add(tipo, data, { jobId })` — dedupe BullMQ
    // preserva o eventId); hoje o replay é lógico (idempotente) + auditado.
    // `mode: 'logical'` deixa isso explícito na resposta (sem quebrar shape:
    // campo aditivo). BullMQ é dependência opcional (ver webhook.queue.ts).
    this.audit.emit({
      actorId: actorOf(req),
      action: 'dlq.replay',
      entity: 'dlq',
      entityId: jobId ?? undefined,
      metadata: {
        queue: q,
        jobId: jobId ?? null,
        count: results.length,
        duplicate: duplicates,
        eventId: results[0]?.eventId ?? null,
      },
    });
    return { queue: q, mode: 'logical', replayed, duplicates, results };
  }
}

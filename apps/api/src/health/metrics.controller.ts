import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Public } from '../common/decorators/public.decorator';
import { metricsContentType, metricsExposition } from './metrics-registry';

// GET /metrics (raiz, fora do prefixo /v1 — ver main.ts exclude).
// Prometheus exposition (texto). Público como /health/* (scrape não autentica).
// Ecoa `x-correlation-id` (gera se ausente) — mesmo contrato das demais rotas.
@Controller('metrics')
export class MetricsController {
  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  exposition(@Req() req: Request, @Res({ passthrough: true }) res: Response): string {
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('Content-Type', metricsContentType());
    return metricsExposition();
  }
}

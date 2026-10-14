import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { observeHttpRequest } from './metrics-registry';

// Interceptor global (Fase 6): alimenta `http_requests_total` +
// `http_request_duration_seconds` em todas as rotas. Sem regra de negócio:
// mede método/rota/status/duração. Rota normalizada a partir do path do
// controller (`route.path`) com fallback para o pathname da URL.
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const http = context.switchToHttp();
    const req = http.getRequest() as {
      method?: string;
      originalUrl?: string;
      url?: string;
      route?: { path?: string };
    };
    const res = http.getResponse() as { statusCode?: number };
    return next.handle().pipe(
      tap({
        next: () => record(req, started, res.statusCode ?? 200),
        error: (err: unknown) => record(req, started, (err as { status?: number })?.status ?? 500),
      }),
    );
  }
}

function routeOf(req: { originalUrl?: string; url?: string; route?: { path?: string } }): string {
  const routePath = req.route?.path;
  if (typeof routePath === 'string' && routePath.length > 0) return routePath;
  const raw = req.originalUrl ?? req.url ?? '/unknown';
  return raw.split('?')[0] || '/unknown';
}

function record(
  req: { method?: string; originalUrl?: string; url?: string; route?: { path?: string } },
  started: number,
  forcedStatus?: number,
): void {
  try {
    const seconds = (Date.now() - started) / 1000;
    observeHttpRequest(req.method ?? 'UNKNOWN', routeOf(req), forcedStatus ?? 200, seconds);
  } catch {
    // métricas nunca quebram o request
  }
}

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { sanitizeAuditMetadata } from './audit-record';

// Interceptor complementar ao emit explícito do LicensingFlowService.
// Escopo: rotas FORA de `/v1/licenses` (ex. `POST /v1/access/bonus` →
// `bonus.grant`, cujo controller é pré-existente e não pode ser editado na
// Fase 3). Rotas de licenças são ignoradas aqui para não duplicar eventos.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest() as {
      method?: string;
      url?: string;
      path?: string;
      headers?: Record<string, unknown>;
      body?: Record<string, unknown>;
    };
    return next.handle().pipe(
      tap({
        next: (body) => {
          const action = actionFor(req.method ?? '', req.path ?? req.url ?? '');
          if (!action) return;
          if (isLicensesRoute(req.path ?? req.url ?? '')) return;
          const b = (body ?? {}) as Record<string, unknown>;
          const headerActor = req.headers?.['x-actor'];
          this.audit.emit({
            actorId:
              (typeof headerActor === 'string' ? headerActor : undefined) ??
              (typeof req.body?.actor === 'string' ? (req.body.actor as string) : undefined) ??
              (typeof req.body?.grantedBy === 'string' ? (req.body.grantedBy as string) : undefined),
            action,
            entity: entityFor(action),
            entityId: typeof b.id === 'string' ? b.id : undefined,
            metadata: sanitizeAuditMetadata({
              keyMasked: b.keyMasked,
              device_hash: b.deviceHash ?? b.device_hash,
              reason: req.body?.reason ?? b.reason,
              eventId: b.eventId,
            }),
          });
        },
      }),
    );
  }
}

function isLicensesRoute(path: string): boolean {
  return path.includes('/licenses');
}

/** Heurística conservadora: só mapeia o que conhece; resto retorna null (sem evento). */
export function actionFor(method: string, path: string): string | null {
  if (method !== 'POST') return null;
  if (path.includes('/bonus') || path.endsWith('/grant')) return 'bonus.grant';
  return null;
}

function entityFor(action: string): string {
  if (action === 'bonus.grant') return 'bonus';
  return 'unknown';
}

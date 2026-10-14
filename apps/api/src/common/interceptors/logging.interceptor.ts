import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

// TODO(T5): logging estruturado por request (pino + x-correlation-id) vive em libs/observability.
// Stub T2 Fase 1: passthrough, sem lógica.
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle();
  }
}

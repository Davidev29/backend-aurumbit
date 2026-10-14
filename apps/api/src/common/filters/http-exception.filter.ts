import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

// TODO(T5): envelope de erro padrão + x-correlation-id + mapeamento de erros de domínio. Passthrough mínimo em T2.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    res.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}

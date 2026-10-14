import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { toPrincipal } from '../auth/jwt-payload';
import { JwtError, JwtService } from '../auth/jwt.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * 1º da cadeia APP_GUARD. Valida o Bearer JWT (iss/aud/exp/jti/sid) e
 * anexa `request.user` (`AuthPrincipal`). Rotas `@Public()` pulam.
 * Sem token/claims inválidas → 401 (sem distinguir motivo no detalhe —
 * anti-enumeração; o `code` vai no corpo p/ suporte).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const klass = context.getClass();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, klass])) return true;

    const req = context.switchToHttp().getRequest();
    const token = extractBearer(req.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token de acesso ausente.' });
    }
    try {
      req.user = toPrincipal(this.jwt.verify(token));
      return true;
    } catch (e) {
      const code = e instanceof JwtError ? mapJwtCode(e.code) : 'UNAUTHORIZED';
      throw new UnauthorizedException({ code, message: 'Token de acesso inválido.' });
    }
  }
}

function extractBearer(authorization: unknown): string {
  if (typeof authorization !== 'string') return '';
  const [scheme, token] = authorization.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return '';
  return token;
}

function mapJwtCode(code: JwtError['code']): string {
  switch (code) {
    case 'TOKEN_EXPIRED':
      return 'TOKEN_EXPIRED';
    case 'TOKEN_ISSUER':
    case 'TOKEN_AUDIENCE':
      return 'TOKEN_REJECTED';
    default:
      return 'UNAUTHORIZED';
  }
}

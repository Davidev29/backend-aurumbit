import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/jwt-payload';
import { SESSION_LOOKUP, SessionLookup } from '../auth/session-lookup.port';

/**
 * 2º da cadeia APP_GUARD. Exige `AuthSession` ACTIVE e não expirada
 * (via porta `SESSION_LOOKUP` — adaptador Prisma na Fase 3).
 * Rotas públicas (sem `request.user`) pulam. Falhas → 401.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SESSION_LOOKUP) private readonly sessions: SessionLookup) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthPrincipal | undefined;
    if (!user) return true;

    const session = await this.sessions.findById(user.sessionId);
    if (!session) {
      throw new UnauthorizedException({ code: 'SESSION_NOT_FOUND', message: 'Sessão inválida.' });
    }
    if (session.identityId !== user.identityId) {
      throw new UnauthorizedException({ code: 'SESSION_MISMATCH', message: 'Sessão inválida.' });
    }
    if (session.status !== 'ACTIVE' || session.revokedAt) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Sessão revogada.' });
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Sessão expirada.' });
    }
    return true;
  }
}

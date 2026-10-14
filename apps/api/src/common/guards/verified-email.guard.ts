import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthPrincipal } from '../auth/jwt-payload';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/customer-scope.decorator';

/**
 * 4º da cadeia APP_GUARD. Exige `email_verified` em rotas autenticadas.
 * Rotas `@AllowUnverified()` (ex. reenvio de verificação) e públicas pulam.
 * Sem verificação → 403 `EMAIL_NOT_VERIFIED`.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthPrincipal | undefined;
    if (!user) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    if (user.emailVerified) return true;
    throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED', message: 'E-mail não verificado.' });
  }
}

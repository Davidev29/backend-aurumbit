import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthPrincipal } from '../auth/jwt-payload';
import { REQUIRE_MFA_KEY } from '../decorators/require-mfa.decorator';

/**
 * 3º da cadeia APP_GUARD. Só age em rotas `@RequireMfa()`: exige `mfa`
 * no claim `amr` (step-up concluído — OIDC `amr: ["pwd","mfa"]`).
 * Sem MFA → 403 `MFA_REQUIRED`.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthPrincipal | undefined;
    if (!user) return true;
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    if (user.amr.includes('mfa')) return true;
    throw new ForbiddenException({ code: 'MFA_REQUIRED', message: 'Autenticação em duas etapas exigida.' });
  }
}

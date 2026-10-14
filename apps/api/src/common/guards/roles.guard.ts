import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthPrincipal } from '../auth/jwt-payload';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * 5º da cadeia APP_GUARD. Só age em rotas `@Roles(...)`: exige ao menos
 * uma role do JWT. Convenção staff `STAFF_*` (PROJECT §3 — `finance.read`
 * é concessão explícita escopada, nunca implícita). Sem role → 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthPrincipal | undefined;
    if (!user) return true;
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    if (required.some((r) => user.roles.includes(r))) return true;
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Permissão insuficiente.',
      details: { required },
    });
  }
}

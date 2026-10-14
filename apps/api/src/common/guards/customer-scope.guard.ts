import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthPrincipal } from '../auth/jwt-payload';
import { MEMBERSHIP_LOOKUP, MembershipLookup } from '../auth/membership-lookup.port';
import { CUSTOMER_SCOPE_KEY } from '../decorators/customer-scope.decorator';

/** Escopo de org resolvido, anexado a `request.org`. */
export interface RequestOrg {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'FINANCE' | 'MEMBER';
}

/**
 * 6º da cadeia APP_GUARD. Só age em rotas `@CustomerScope()`: resolve
 * `X-Org-Id` + membership ACTIVE (via `MEMBERSHIP_LOOKUP` — Prisma Fase 3)
 * e anexa `request.org`. Sem header → 400; sem vínculo ACTIVE → 403.
 */
@Injectable()
export class CustomerScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(MEMBERSHIP_LOOKUP) private readonly memberships: MembershipLookup,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthPrincipal | undefined;
    if (!user) return true;
    const scoped = this.reflector.getAllAndOverride<boolean>(CUSTOMER_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scoped) return true;

    const raw = req.headers?.['x-org-id'];
    const orgId = Array.isArray(raw) ? raw[0] : raw;
    if (typeof orgId !== 'string' || !orgId) {
      throw new BadRequestException({ code: 'ORG_REQUIRED', message: 'Header X-Org-Id é obrigatório.' });
    }
    const membership = await this.memberships.findMembership(orgId, user.identityId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ORG_FORBIDDEN', message: 'Sem vínculo ativo com a organização.' });
    }
    req.org = { id: orgId, role: membership.role } satisfies RequestOrg;
    return true;
  }
}

import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CheckAccessResponseSchema } from '../../../../libs/contracts/src/access';
import type { AuthPrincipal } from '../../src/common/auth/jwt-payload';
import { AllowUnverified, CustomerScope } from '../../src/common/decorators/customer-scope.decorator';
import { CurrentUser } from '../../src/common/decorators/current-user.decorator';
import { Public } from '../../src/common/decorators/public.decorator';
import { RequireMfa } from '../../src/common/decorators/require-mfa.decorator';
import { Roles } from '../../src/common/decorators/roles.decorator';
import type { RequestOrg } from '../../src/common/guards/customer-scope.guard';
import { EntitlementCandidate, evaluateCheck } from '../../src/modules/access/access-policy';

/**
 * Controller exclusivo dos e2e Fase 2 (nunca registrado no `AppModule`).
 * Expõe uma rota por comportamento da cadeia de guards + cenários do
 * check-access (PROJECT §1) sobre `evaluateCheck` puro.
 */
@Controller('t')
export class GuardedTestController {
  @Public()
  @Get('open')
  open(): { ok: boolean } {
    return { ok: true };
  }

  @Get('protected')
  me(@CurrentUser() user: AuthPrincipal | undefined): { ok: boolean; sub: string | undefined } {
    return { ok: true, sub: user?.identityId };
  }

  @RequireMfa()
  @Get('mfa')
  mfa(): { ok: boolean } {
    return { ok: true };
  }

  @Roles('STAFF_ADMIN')
  @Get('staff')
  staff(): { ok: boolean } {
    return { ok: true };
  }

  @CustomerScope()
  @Get('org')
  org(@Req() req: Request & { org?: RequestOrg }): { ok: boolean; org: RequestOrg | undefined } {
    return { ok: true, org: req.org };
  }

  @AllowUnverified()
  @Get('unverified-ok')
  unverifiedOk(): { ok: boolean } {
    return { ok: true };
  }

  /** Cenários PROJECT §1 → resposta validada contra o contrato zod. */
  @Get('check')
  check(@Query('scenario') scenario: string): unknown {
    const now = Date.now();
    const h = 3_600_000;
    const d = 24 * h;
    const base: EntitlementCandidate = {
      id: 'ent-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      productId: 'prod-1',
      featureCode: 'feat',
      origin: 'LICENSE',
      originId: 'lic-1',
      priority: 30,
      status: 'ACTIVE',
      quotaValue: null,
      startsAt: null,
      expiresAt: new Date(now + h).toISOString(),
      graceUntil: new Date(now + h + 3 * d).toISOString(),
    };
    let candidates: EntitlementCandidate[];
    switch (scenario) {
      case 'grace':
        candidates = [{ ...base, expiresAt: new Date(now - h).toISOString(), graceUntil: new Date(now + 2 * d).toISOString() }];
        break;
      case 'expired':
        candidates = [{ ...base, expiresAt: new Date(now - 4 * d).toISOString(), graceUntil: new Date(now - d).toISOString() }];
        break;
      case 'suspended':
        candidates = [{ ...base, status: 'SUSPENDED' }];
        break;
      case 'notfound':
        candidates = [];
        break;
      case 'active':
      default:
        candidates = [base];
        break;
    }
    const decision = evaluateCheck(candidates, new Date(now));
    const body =
      decision.allow
        ? {
            allow: true,
            degraded: decision.degraded,
            reason: decision.reason,
            entitlementId: decision.entitlementId,
            origin: decision.origin,
            priority: decision.priority,
            quotaValue: decision.quotaValue,
          }
        : { allow: false, degraded: false, reason: decision.reason, errorCode: decision.reason };
    // Garante que o HTTP honra o contrato público (fail-closed no teste).
    return CheckAccessResponseSchema.parse(body);
  }
}

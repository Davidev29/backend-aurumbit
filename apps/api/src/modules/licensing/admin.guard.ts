import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

// TODO(auth real): trocar estes stubs pela cadeia Jwt→Session→Mfa→
// Verified→Roles→CustomerScope (PROJECT.md §3), com `license.read` como
// concessão explícita. Stub atual:
// - escrita admin/system: header `x-role: admin` OU `x-service-token`
//   (quando LICENSE_INTERNAL_TOKEN configurado);
// - reveal: `license.read` (x-role admin OU scope `license.read` OU service)
//   + MFA step-up (`x-mfa: verified`) quando o chamador é admin.

function serviceTokenOk(presented: unknown): boolean {
  const expected = process.env.LICENSE_INTERNAL_TOKEN ?? '';
  if (typeof presented !== 'string' || presented.length === 0 || expected.length === 0) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isService(req: any): boolean {
  return serviceTokenOk(req.headers?.['x-service-token']);
}

/** Escrita do ciclo de vida (issue/renew/suspend/resume/revoke): admin ou system. */
@Injectable()
export class AdminStubGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as { headers?: Record<string, unknown> };
    if (req.headers?.['x-role'] === 'admin' || isService(req)) return true;
    throw new ForbiddenException('admin ou system only (stub RBAC: header x-role: admin)');
  }
}

/**
 * Leitura privilegiada p/ reveal (PROJECT.md §2): exige `license.read`
 * (admin implica; service implica) e, se o chamador é admin humano,
 * MFA step-up (`x-mfa: verified` — ponte p/ @RequireMfa/amr da cadeia real).
 */
@Injectable()
export class LicenseReadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as { headers?: Record<string, unknown> };
    const role = req.headers?.['x-role'];
    const scopes = String(req.headers?.['x-scope'] ?? '')
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);
    const svc = isService(req);
    const isAdmin = role === 'admin';
    if (!isAdmin && !svc && !scopes.includes('license.read')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Permissão insuficiente (license.read).',
      });
    }
    if (isAdmin && !svc) {
      if (req.headers?.['x-mfa'] !== 'verified') {
        throw new ForbiddenException({
          code: 'MFA_REQUIRED',
          message: 'Revelação por admin exige MFA (step-up).',
        });
      }
    }
    return true;
  }
}

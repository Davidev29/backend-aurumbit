import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

// Guarda admin + MFA stub p/ superfície `/v1/admin/dlq` (Fase 6).
// TODO(auth real): trocar pela cadeia Jwt→Session→Mfa→Roles(`admin`)
// com `@RequireMfa()`. Stub atual (mesmo padrão de `licensing/admin.guard.ts`):
// - `x-role: admin` OU `x-service-token` (quando `ADMIN_INTERNAL_TOKEN` configurado);
// - admin humano exige MFA step-up (`x-mfa: verified`); service bypassa o MFA
//   (chamador máquina, segredo de 256 bits) mas continua auditado.

function serviceTokenOk(presented: unknown): boolean {
  const expected = process.env.ADMIN_INTERNAL_TOKEN ?? '';
  if (typeof presented !== 'string' || presented.length === 0 || expected.length === 0) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

@Injectable()
export class DlqAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as { headers?: Record<string, unknown> };
    const headers = req.headers ?? {};
    const svc =
      typeof headers['x-service-token'] === 'string' && serviceTokenOk(headers['x-service-token']);
    if (svc) return true;
    if (headers['x-role'] !== 'admin') {
      throw new ForbiddenException('admin only (stub RBAC: envie header x-role: admin)');
    }
    if (headers['x-mfa'] !== 'verified') {
      throw new ForbiddenException({
        code: 'MFA_REQUIRED',
        message: 'Operação DLQ por admin exige MFA (step-up: header x-mfa: verified).',
      });
    }
    return true;
  }
}

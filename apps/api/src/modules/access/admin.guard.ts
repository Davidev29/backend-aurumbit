import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

// TODO(auth real, Fase 2-auth): trocar este stub por
// Jwt→Session→Mfa→Verified→Roles→CustomerScope (ROADMAP Fase 2, PROJECT.md §3).
// Stub atual: exige header `x-role: admin` nas rotas administrativas.
@Injectable()
export class AdminStubGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as { headers?: Record<string, unknown> };
    const role = req.headers?.['x-role'];
    if (role !== 'admin') {
      throw new ForbiddenException('admin only (stub RBAC: envie header x-role: admin)');
    }
    return true;
  }
}

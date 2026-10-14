/**
 * Projeções — guard de escopo financeiro (Fase 5, PROJECT.md §3).
 *
 * `finance.read` é concessão explícita (default deny); `finance.manage`
 * só admin. Duas vias, sem acesso implícito:
 * 1. JWT (cadeia compartilhada `common/guards` → `request.user.roles`):
 *    `finance.read` libera leitura; `finance.manage` (ou `admin`)
 *    libera recompute. `STAFF_ADMIN`/`STAFF_FINANCE` mapeiam p/ leitura
 *    (convenção staff legada — a concessão explícita continua registrada
 *    em Membership/RoleGrant pelo dono do auth).
 * 2. Stub dev/teste (mesmo padrão de `AdminStubGuard`): header `x-role`:
 *    `admin` = ambos; `finance`/`finance.read` = leitura;
 *    `finance.manage` = ambos.
 * Sem credencial → 403 (nunca 401 implícito aqui; autenticação é da
 * cadeia global).
 *
 * TODO(core/auth): trocar o stub por checagem de Membership escopada por
 * organização + auditoria da concessão.
 */

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';

export const FINANCE_SCOPE_KEY = 'finance:required-scope';

export const RequireFinanceScope = (...scopes: Array<'finance.read' | 'finance.manage'>): MethodDecorator & ClassDecorator =>
  SetMetadata(FINANCE_SCOPE_KEY, scopes);

@Injectable()
export class FinanceProjectionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Array<'finance.read' | 'finance.manage'>>(
      FINANCE_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest() as {
      user?: { roles?: string[] };
      headers?: Record<string, unknown>;
    };
    const granted = new Set<'finance.read' | 'finance.manage'>();
    for (const r of req.user?.roles ?? []) {
      if (r === 'finance.read' || r === 'STAFF_FINANCE' || r === 'STAFF_ADMIN' || r === 'admin') {
        granted.add('finance.read');
      }
      if (r === 'finance.manage' || r === 'STAFF_ADMIN' || r === 'admin') {
        granted.add('finance.manage');
      }
    }
    const stub = String(req.headers?.['x-role'] ?? '');
    if (stub === 'admin') {
      granted.add('finance.read');
      granted.add('finance.manage');
    } else if (stub === 'finance' || stub === 'finance.read' || stub === 'STAFF_FINANCE') {
      granted.add('finance.read');
    } else if (stub === 'finance.manage') {
      granted.add('finance.read');
      granted.add('finance.manage');
    }
    if (required.every((s) => granted.has(s))) return true;
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Permissão insuficiente (finance.read explícito; recompute exige finance.manage).',
    });
  }
}

/**
 * Guarda do endpoint interno do worker: `x-internal-key` deve casar com
 * `INTERNAL_PROJECTION_KEY`. Fail-closed: sem env configurada, nega
 * (fora de `test`, onde o service é exercitado direto).
 */
@Injectable()
export class InternalProjectionKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as { headers?: Record<string, unknown> };
    const expected = process.env.INTERNAL_PROJECTION_KEY;
    const got = String(req.headers?.['x-internal-key'] ?? '');
    if (expected && got === expected) return true;
    if (!expected && process.env.NODE_ENV === 'test' && got) return true;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Chave interna inválida.' });
  }
}

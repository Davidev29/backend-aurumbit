import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

// TODO(RBAC real, Fase 5-hardening): trocar este stub por
// RolesGuard(`finance.read`) + CustomerScopeGuard (membership ACTIVE com
// role OWNER/ADMIN/FINANCE) + AuditEvent `finance.read.grant` (PROJECT.md
// §3 — concessão explícita, escopada por organização, default deny).
//
// Stub unificado (core + flow/projections, Fase 5): `finance.read` é a
// concessão explícita transportada pelo header `x-finance-read: <orgId>`
// (ou `x-role: admin`, que implica leitura). O escopo resolve nesta ordem:
// header `x-org-id` → query `orgId`/`org_id` → body `orgId`. Concessão
// divergente do escopo (ou ausente) → 403. Escopo resolvido é anexado a
// `request.financeOrg = { id }` para os controllers escoparem as queries.
export interface FinanceOrg {
  id: string;
}

@Injectable()
export class FinanceReadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as {
      headers?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
      financeOrg?: FinanceOrg;
    };
    const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
    const role = first(req.headers?.['x-role']);
    const headerOrg = first(req.headers?.['x-org-id']);
    const scope =
      (typeof headerOrg === 'string' && headerOrg.length > 0 ? headerOrg : null) ??
      (typeof req.query?.['orgId'] === 'string' && req.query['orgId'].length > 0
        ? (req.query['orgId'] as string)
        : null) ??
      (typeof req.query?.['org_id'] === 'string' && (req.query['org_id'] as string).length > 0
        ? (req.query['org_id'] as string)
        : null) ??
      (typeof req.body?.['orgId'] === 'string' && (req.body['orgId'] as string).length > 0
        ? (req.body['orgId'] as string)
        : null);
    if (role === 'admin') {
      if (scope) req.financeOrg = { id: scope };
      return true;
    }
    const granted = first(req.headers?.['x-finance-read']);
    if (typeof granted !== 'string' || granted.length === 0) {
      throw new ForbiddenException('finance.read requerido (stub: envie header x-finance-read: <orgId>)');
    }
    if (scope !== null && granted !== scope) {
      throw new ForbiddenException('finance.read fora do escopo da organização');
    }
    if (scope !== null) req.financeOrg = { id: scope };
    return true;
  }
}

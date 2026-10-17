import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { STAFF_ROLES } from '../auth/jwt-payload';
import type { AuthPrincipal } from '../auth/jwt-payload';

/**
 * Acesso de STAFF às rotas administrativas de leitura de clientes.
 *
 * Por que não basta `@Roles(...)`: o `RolesGuard` global só age em rotas
 * anotadas e o login do domínio `auth` ainda emite `roles: []` (RBAC de staff
 * é o TODO A4 do admin). Sem isto, qualquer identidade — inclusive um cliente
 * do portal com JWT válido — poderia ler a lista de e-mails de todos os
 * titulares só por mandar `x-role: admin`.
 *
 * Duas portas, ambas fail-closed:
 * 1. `roles` do JWT com convenção `STAFF_*` (caminho definitivo, já suportado
 *    pelo `RolesGuard` quando o RBAC de staff existir);
 * 2. allowlist de e-mails em `ADMIN_STAFF_EMAILS` — o diretório resolve o
 *    e-mail da identidade (o JWT não carrega PII, por LGPD §3).
 *
 * Sem `ADMIN_STAFF_EMAILS` definido, a porta 2 nega TODO mundo: o admin
 * precisa ser declarado explicitamente, nunca "aberto" por omissão.
 */
export interface StaffDirectory {
  /** E-mail da identidade autenticada, ou null quando não existe. */
  emailOf(identityId: string): Promise<string | null>;
}

export const STAFF_DIRECTORY = 'STAFF_DIRECTORY';

/** Allowlist de e-mails de staff (`ADMIN_STAFF_EMAILS=a@b.com,c@d.com`). */
export function allowedStaffEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_STAFF_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

@Injectable()
export class StaffGuard implements CanActivate {
  // `@Inject` explícito: `StaffDirectory` é interface (sem token de classe),
  // então o Nest não conseguiria resolver o parâmetro sozinho.
  constructor(@Inject(STAFF_DIRECTORY) private readonly directory: StaffDirectory) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request?.user as AuthPrincipal | undefined;
    if (!user?.identityId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Sessão de staff obrigatória.',
      });
    }
    // 1) Role no token (definitivo; precede a allowlist).
    if ((user.roles ?? []).some((r) => (STAFF_ROLES as readonly string[]).includes(r))) {
      return true;
    }
    // 2) Allowlist de e-mails (ponte até o RBAC de staff existir).
    const allowed = allowedStaffEmails();
    if (allowed.size === 0) {
      throw new ForbiddenException({
        code: 'STAFF_NOT_CONFIGURED',
        message: 'Acesso staff não configurado (defina ADMIN_STAFF_EMAILS).',
      });
    }
    const email = (await this.directory.emailOf(user.identityId))?.trim().toLowerCase() ?? null;
    if (!email || !allowed.has(email)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Permissão insuficiente.',
      });
    }
    return true;
  }
}
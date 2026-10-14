import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AUTH_REPOSITORY, IAuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

export interface RequestAuth {
  identityId: string;
  sessionId: string;
  familyId: string;
  mfa: boolean;
}

/** Valida o Bearer access JWT (15min) e anexa req.auth. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const h = String(req.headers?.authorization ?? '');
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) throw new HttpException({ code: 'UNAUTHORIZED', message: 'Não autorizado.' }, HttpStatus.UNAUTHORIZED);
    try {
      const c = this.auth.verifyAccess(token);
      (req as any).auth = { identityId: c.identityId, sessionId: c.sessionId, familyId: c.familyId, mfa: c.mfa } as RequestAuth;
      return true;
    } catch (e: any) {
      const status = e?.status ?? HttpStatus.UNAUTHORIZED;
      throw new HttpException({ code: e?.code ?? 'UNAUTHORIZED', message: 'Não autorizado.' }, status);
    }
  }
}

/** Após o JWT, garante que a sessão (sid) segue ACTIVE e não expirada. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repo: IAuthRepository, private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const a = (req as any).auth as RequestAuth | undefined;
    if (!a) throw new HttpException({ code: 'UNAUTHORIZED', message: 'Não autorizado.' }, HttpStatus.UNAUTHORIZED);
    try {
      await this.auth.assertSessionActive(a.sessionId, a.identityId);
      return true;
    } catch (e: any) {
      throw new HttpException({ code: e?.code ?? 'SESSION_INVALID', message: 'Sessão inválida.' }, HttpStatus.UNAUTHORIZED);
    }
  }
}

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/jwt-payload';

/** Principal autenticado anexado pelo `JwtAuthGuard` (`request.user`). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal | undefined => {
    return ctx.switchToHttp().getRequest().user as AuthPrincipal | undefined;
  },
);

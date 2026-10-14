import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthError } from './auth.types';
import { isSameOriginRequest } from './csrf';
import { ChangePasswordDto, ForgotDto, LoginDto, MfaVerifyDto, RefreshDto, RegisterDto, ResendVerificationDto, ResetDto, VerifyEmailDto } from './dto';
import { JwtAuthGuard, RequestAuth, SessionGuard } from './guards';
import { AuthRateLimitGuard, RateLimit } from './rate-limit';
import { Public } from '../../common/decorators/public.decorator';

const REFRESH_COOKIE = 'ab_refresh';

function parseRefreshCookie(req: any): string {
  const raw = String(req.headers?.cookie ?? '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === REFRESH_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/v1/auth',
    maxAge: 30 * 24 * 3600_000,
  });
}

function reqAuth(req: any): RequestAuth {
  return (req as any).auth as RequestAuth;
}

function toHttp(e: unknown): never {
  if (e instanceof AuthError) {
    throw new HttpException({ code: e.code, message: e.message }, e.status);
  }
  throw e;
}

// Rotas sob o prefixo global /v1 → POST /v1/auth/register, etc.
@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @RateLimit('register')
  async register(@Body() dto: RegisterDto) {
    try {
      return await this.auth.register({ email: dto.email, password: dto.password, consents: dto.consents, deviceLabel: dto.deviceLabel });
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  @RateLimit('verify')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    try {
      return await this.auth.verifyEmail(dto.token);
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(200)
  @RateLimit('recovery')
  async resend(@Body() dto: ResendVerificationDto) {
    try {
      return await this.auth.resendVerification(dto.email);
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    try {
      const r = await this.auth.login({ email: dto.email, password: dto.password, deviceLabel: dto.deviceLabel });
      return r;
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @RateLimit('login')
  async refresh(@Req() req: any, @Body() dto: RefreshDto, @Res({ passthrough: true }) res: Response) {
    try {
      const fromCookie = !dto.refreshToken && parseRefreshCookie(req) !== '';
      // Fase 6 (CSRF): refresh via cookie httpOnly exige request same-origin.
      // Token no corpo (curl/SDK/app) segue sem a checagem — CSRF é ameaça de navegador.
      if (fromCookie) {
        const host =
          (typeof req.get === 'function' && (req.get('x-forwarded-host') ?? req.get('host'))) ||
          req.headers?.host;
        if (!isSameOriginRequest({ headers: req.headers, host })) {
          throw new AuthError('FORBIDDEN_ORIGIN', 403, 'Origem inválida para refresh via cookie.');
        }
      }
      const raw = dto.refreshToken ?? parseRefreshCookie(req);
      if (!raw) throw new AuthError('INVALID_TOKEN', 401, 'Sessão inválida.');
      const r = await this.auth.refresh(raw);
      if (dto.setCookie === true) setRefreshCookie(res, r.refreshToken);
      return r;
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, SessionGuard)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    try {
      const a = reqAuth(req);
      try {
        res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
      } catch {
        /* noop */
      }
      return await this.auth.logout(a.identityId, a.sessionId);
    } catch (e) {
      toHttp(e);
    }
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, SessionGuard)
  async sessions(@Req() req: any) {
    try {
      const a = reqAuth(req);
      return { data: await this.auth.listSessions(a.identityId) };
    } catch (e) {
      toHttp(e);
    }
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard, SessionGuard)
  async revokeSession(@Req() req: any, @Param('id') id: string) {
    try {
      return await this.auth.revokeSession(reqAuth(req).identityId, id);
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('forgot')
  @Public()
  @HttpCode(200)
  @RateLimit('recovery')
  async forgot(@Body() dto: ForgotDto) {
    try {
      return await this.auth.forgotPassword(dto.email);
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('reset')
  @Public()
  @HttpCode(200)
  @RateLimit('recovery')
  async reset(@Body() dto: ResetDto) {
    try {
      return await this.auth.resetPassword(dto.token, dto.newPassword);
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, SessionGuard)
  async changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    try {
      const a = reqAuth(req);
      return await this.auth.changePassword(a.identityId, dto.currentPassword, dto.newPassword, a.sessionId);
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  @RateLimit('mfa')
  @UseGuards(JwtAuthGuard, SessionGuard)
  async mfaEnroll(@Req() req: any) {
    try {
      return await this.auth.mfaEnroll(reqAuth(req).identityId);
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('mfa/verify')
  @Public()
  @HttpCode(200)
  @RateLimit('mfa')
  async mfaVerify(@Req() req: any, @Body() dto: MfaVerifyDto) {
    try {
      const code = String(dto.code ?? '');
      if (dto.ticket) {
        return await this.auth.mfaCompleteLogin(dto.ticket, code, dto.deviceLabel);
      }
      const a = (req as any).auth as RequestAuth | undefined;
      if (!a) throw new AuthError('UNAUTHORIZED', 401, 'Não autorizado.');
      return await this.auth.mfaVerifyEnrollment(a.identityId, code);
    } catch (e) {
      toHttp(e);
    }
  }

  // Fase 6 (LGPD): portabilidade e eliminação no domínio auth.
  // Ordem canônica (runbook): `customers/gdpr/anonymize` primeiro (pode
  // negar 409 ACTIVE com vigência), depois este endpoint.
  @Get('gdpr/export')
  @UseGuards(JwtAuthGuard, SessionGuard)
  async gdprExport(@Req() req: any) {
    try {
      return await this.auth.exportData(reqAuth(req).identityId);
    } catch (e) {
      toHttp(e);
    }
  }

  @Post('gdpr/anonymize')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, SessionGuard)
  async gdprAnonymize(@Req() req: any) {
    try {
      return await this.auth.anonymize(reqAuth(req).identityId);
    } catch (e) {
      toHttp(e);
    }
  }
}

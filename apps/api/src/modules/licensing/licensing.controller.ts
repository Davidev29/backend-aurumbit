import { Body, Controller, Get, Headers, Logger, Param, Post, Query, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { LicenseReadGuard } from './admin.guard';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { IssueFromPaymentDto, IssueLicenseDto, IssueTrialDto, ExtendLicenseDto, LicenseReasonDto, ListLicensesQueryDto, RenewLicenseDto, RevealLicenseDto } from './licenses.dto';
import { Public } from '../../common/decorators/public.decorator';
import { LicensesService } from './licenses.service';
import { RevealRateLimitGuard } from './reveal.guard';
import type { AuthPrincipal } from '../../common/auth/jwt-payload';

// Licensing core (Fase 3, PROJECT.md §§1-2): /v1/licenses. Respostas sempre
// mascaradas; plaintext só em issue (1x, entrega) e reveal (auditado).
// Devices/offline-token: outro workstream (endpoints separados).
@Controller('licenses')
export class LicensingController {
  private readonly logger = new Logger(LicensingController.name);

  constructor(private readonly licenses: LicensesService) {}

  @Get()
  list(@Query() q: ListLicensesQueryDto, @Req() req: any) {
    // `?mine=1`: titular autenticado lista as próprias licenças CUSTOMER.
    // Convenção: licenças de cliente usam `ownerId` = identityId do JWT.
    if (q.mine === '1' || q.mine === 'true') {
      const user = req?.user as AuthPrincipal | undefined;
      if (!user?.identityId) {
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token de acesso ausente.' });
      }
      return this.licenses
        .listLicenses('CUSTOMER', user.identityId, { productId: q.productId, status: q.status })
        .then((items) => ({ items }));
    }
    return this.licenses
      .listLicenses(q.ownerType, q.ownerId, { productId: q.productId, status: q.status })
      .then((items) => ({ items }));
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.licenses.getLicense(id);
  }

  /**
   * Histórico append-only da licença (PG outbox): emissão/renovações/
   * suspensões/revogações com motivo e sucessora. Admin-only.
   */
  @Get(':id/history')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  history(@Param('id') id: string) {
    return this.licenses.licenseHistory(id);
  }

  @Post()
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  issue(@Body() dto: IssueLicenseDto, @Req() req: any) {
    return this.licenses.issueLicense(dto, actorOf(req));
  }

  /**
   * Lote demo/promo sem conta (trial horas/dias ou lifetime parceria).
   * Admin-only. Retorna plaintext 1x por chave (exibir uma vez, depois só máscara).
   * Ativação pelo programa é só por chave: POST /v1/licenses/activate-by-key.
   */
  @Post('trial-issue')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  trialIssue(@Body() dto: IssueTrialDto, @Req() req: any) {
    return this.licenses.issueTrial(dto, actorOf(req));
  }

  @Post(':id/renew')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  renew(@Param('id') id: string, @Body() dto: RenewLicenseDto, @Req() req: any) {
    return this.licenses.renewLicense(id, dto.kind, actorOf(req));
  }

  /**
   * Prorrogação IN-PLACE: estende a MESMA licença (preserva chave e
   * vínculos de máquina) — o resgate da chave vencida sem trocar a chave
   * do cliente. Diferente de `/renew`, que emite licença nova. Admin-only,
   * motivo obrigatório, outbox `LicenseExtended` + trilha de auditoria.
   */
  @Post(':id/extend')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  async extend(@Param('id') id: string, @Body() dto: ExtendLicenseDto, @Req() req: any) {
    const actor = actorOf(req);
    const out = await this.licenses.extendLicense(id, dto.months, dto.reason, actor);
    this.logger.log(
      JSON.stringify({
        event: 'license.extend',
        licenseId: id,
        months: dto.months,
        actor,
        reason: dto.reason,
        previousExpiresAt: out.previousExpiresAt,
        expiresAt: out.license.expiresAt,
        at: new Date().toISOString(),
      }),
    );
    return out;
  }

  @Post(':id/suspend')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  suspend(@Param('id') id: string, @Body() dto: LicenseReasonDto, @Req() req: any) {
    return this.licenses.suspendLicense(id, dto.reason, actorOf(req));
  }

  @Post(':id/resume')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  resume(@Param('id') id: string, @Body() dto: LicenseReasonDto, @Req() req: any) {
    // `actor` vai p/ o payload do outbox `LicenseResumed` — sem ele a
    // reativação não deixava rastro de quem reativou.
    return this.licenses.resumeLicense(id, dto.reason, actorOf(req));
  }

  @Post(':id/revoke')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  revoke(@Param('id') id: string, @Body() dto: LicenseReasonDto, @Req() req: any) {
    return this.licenses.revokeLicense(id, dto.reason, actorOf(req), dto.replacedBy);
  }

  /**
   * Emissão via PaymentConfirmed (Fase 8, interno worker→API, `@Public()` +
   * `x-internal-key` — mesmo padrão do apply do webhook billing). Claim-first
   * por eventId: replay do mesmo pagamento → `{duplicate:true}`, sem 2ª licença.
   * Sem a chave interna configurada (`INTERNAL_WEBHOOK_KEY`) → 503 fail-closed.
   */
  @Public()
  @Post('internal/issue-from-payment')
  async issueFromPayment(@Body() dto: IssueFromPaymentDto, @Headers('x-internal-key') key?: string) {
    const expected = process.env.INTERNAL_WEBHOOK_KEY ?? null;
    if (!expected) {
      throw new ServiceUnavailableException(
        'emissão interna indisponível (INTERNAL_WEBHOOK_KEY não configurado)',
      );
    }
    if (typeof key !== 'string' || key !== expected) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Chave interna inválida.' });
    }
    return this.licenses.issueFromPayment({ ...dto, actor: 'system:payment-confirmed' });
  }

  /**
   * Revelação (PROJECT.md §2): license.read + MFA se admin + 10/h.
   * Retorna plaintext 1x e registra trilha `license.reveal` (ator/motivo —
   * nunca a chave). TODO(Fase audit): persistir em audit.AuditEvent.
   */
  @Post(':id/reveal')
  @UseGuards(RevealRateLimitGuard, LicenseReadGuard)
  async reveal(@Param('id') id: string, @Body() dto: RevealLicenseDto, @Req() req: any) {
    const actor = actorOf(req);
    const out = await this.licenses.revealKey(id);
    this.logger.log(
      JSON.stringify({
        event: 'license.reveal',
        licenseId: id,
        actor,
        reason: dto.reason ?? null,
        at: new Date().toISOString(),
      }),
    );
    return { licenseId: out.licenseId, key: out.key, keyMasked: out.keyMasked, revealedAt: new Date().toISOString() };
  }
}

function actorOf(req: any): string {
  const user = req?.user as AuthPrincipal | undefined;
  if (user?.identityId) return `identity:${user.identityId}`;
  const h = req?.headers ?? {};
  if (typeof h['x-service-token'] === 'string' && h['x-service-token'].length > 0) return 'system';
  return `role:unknown`;
}

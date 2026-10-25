import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../common/auth/jwt-payload';
import {
  CreateOrganizationDto,
  InviteMemberDto,
  PatchMeDto,
  RecordConsentDto,
  UpdateMemberDto,
  UpgradeToPjDto,
} from './customers.dto';

// Rotas /v1/customers (prefixo global `v1` configurado em main.ts).
// Identidade vem do JWT (`request.user.sub` = identityId, injetado pelo
// `CurrentUser` e preenchido pelo `JwtAuthGuard`). O header `x-identity-id`
// foi REMOVIDO: não era autêntico (podia ser forjado) e permitia IDOR /
// takeover de qualquer titular — identidade agora só do token válido.
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  private identityOf(user: AuthPrincipal | undefined): string {
    if (!user?.identityId) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Não autenticado.' });
    }
    return user.identityId;
  }

  @Get('me')
  getMe(@CurrentUser() user?: AuthPrincipal) {
    return this.customers.getMe(this.identityOf(user));
  }

  @Patch('me')
  patchMe(@CurrentUser() user?: AuthPrincipal, @Body() dto?: PatchMeDto) {
    return this.customers.patchMe(this.identityOf(user), dto ?? {});
  }

  @Post('upgrade-to-pj')
  upgradeToPj(
    @CurrentUser() user?: AuthPrincipal,
    @Headers('x-org-id') headerOrgId?: string,
    @Body() dto?: UpgradeToPjDto,
  ) {
    const id = this.identityOf(user);
    const orgId = this.customers.resolveOrgScope(headerOrgId, dto?.organizationId);
    return this.customers.upgradeToPj(id, { organizationId: orgId, cnpj: dto?.cnpj });
  }

  @Post('organizations')
  @HttpCode(HttpStatus.CREATED)
  createOrganization(
    @CurrentUser() user?: AuthPrincipal,
    @Body() dto?: CreateOrganizationDto,
  ) {
    if (!dto) throw new BadRequestException('Corpo obrigatório');
    return this.customers.createOrganization(this.identityOf(user), {
      razaoSocial: dto.razaoSocial,
      cnpj: dto.cnpj,
    });
  }

  @Get('organizations')
  listOrganizations(@CurrentUser() user?: AuthPrincipal) {
    return this.customers.listOrganizations(this.identityOf(user));
  }

  @Get('organizations/:orgId/members')
  listMembers(
    @CurrentUser() user?: AuthPrincipal,
    @Headers('x-org-id') headerOrgId?: string,
    @Param('orgId') orgId?: string,
  ) {
    const caller = this.identityOf(user);
    const scope = this.customers.resolveOrgScope(headerOrgId, orgId);
    if (!scope) throw new BadRequestException('orgId obrigatório');
    return this.customers.listMembers(caller, scope);
  }

  @Post('organizations/:orgId/members/invite')
  @HttpCode(HttpStatus.CREATED)
  inviteMember(
    @CurrentUser() user?: AuthPrincipal,
    @Headers('x-org-id') headerOrgId?: string,
    @Param('orgId') orgId?: string,
    @Body() dto?: InviteMemberDto,
  ) {
    const caller = this.identityOf(user);
    const scope = this.customers.resolveOrgScope(headerOrgId, orgId);
    if (!scope) throw new BadRequestException('orgId obrigatório');
    if (!dto) throw new BadRequestException('Corpo obrigatório');
    return this.customers.inviteMember(caller, scope, {
      identityId: dto.identityId,
      role: dto.role,
    });
  }

  @Patch('organizations/:orgId/members/:memberIdentityId')
  updateMember(
    @CurrentUser() user?: AuthPrincipal,
    @Headers('x-org-id') headerOrgId?: string,
    @Param('orgId') orgId?: string,
    @Param('memberIdentityId') memberIdentityId?: string,
    @Body() dto?: UpdateMemberDto,
  ) {
    const caller = this.identityOf(user);
    const scope = this.customers.resolveOrgScope(headerOrgId, orgId);
    if (!scope || !memberIdentityId) throw new BadRequestException('orgId/memberIdentityId obrigatórios');
    return this.customers.updateMember(caller, scope, memberIdentityId, dto ?? {});
  }

  @Delete('organizations/:orgId/members/:memberIdentityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user?: AuthPrincipal,
    @Headers('x-org-id') headerOrgId?: string,
    @Param('orgId') orgId?: string,
    @Param('memberIdentityId') memberIdentityId?: string,
  ): Promise<void> {
    const caller = this.identityOf(user);
    const scope = this.customers.resolveOrgScope(headerOrgId, orgId);
    if (!scope || !memberIdentityId) throw new BadRequestException('orgId/memberIdentityId obrigatórios');
    this.customers.removeMember(caller, scope, memberIdentityId);
  }

  @Get('consents')
  listConsents(@CurrentUser() user?: AuthPrincipal) {
    return this.customers.listConsents(this.identityOf(user));
  }

  @Post('consents')
  @HttpCode(HttpStatus.CREATED)
  recordConsent(@CurrentUser() user?: AuthPrincipal, @Body() dto?: RecordConsentDto) {
    if (!dto) throw new BadRequestException('Corpo obrigatório');
    return this.customers.recordConsent(this.identityOf(user), {
      purpose: dto.purpose,
      version: dto.version,
      status: dto.status,
      policyHash: dto.policyHash,
    });
  }

  @Get('gdpr/export')
  exportData(@CurrentUser() user?: AuthPrincipal) {
    return this.customers.exportData(this.identityOf(user));
  }

  @Post('gdpr/anonymize')
  anonymize(@CurrentUser() user?: AuthPrincipal) {
    return this.customers.anonymize(this.identityOf(user));
  }
}

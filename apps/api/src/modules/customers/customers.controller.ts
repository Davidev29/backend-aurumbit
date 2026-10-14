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
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import {
  CreateOrganizationDto,
  InviteMemberDto,
  PatchMeDto,
  RecordConsentDto,
  UpdateMemberDto,
  UpgradeToPjDto,
} from './customers.dto';

// Rotas /v1/customers (prefixo global `v1` configurado em main.ts).
// Identidade stub: header `x-identity-id` até a Fase auth ligar JWT/sessão.
// Escopo PJ: header opcional `X-Org-Id`; se presente junto de :orgId, devem coincidir.
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  private identityOrThrow(value: string | undefined): string {
    if (!value || value.trim() === '') {
      throw new BadRequestException('Header x-identity-id é obrigatório');
    }
    return value;
  }

  @Get('me')
  getMe(@Headers('x-identity-id') identityId?: string) {
    return this.customers.getMe(this.identityOrThrow(identityId));
  }

  @Patch('me')
  patchMe(@Headers('x-identity-id') identityId?: string, @Body() dto?: PatchMeDto) {
    return this.customers.patchMe(this.identityOrThrow(identityId), dto ?? {});
  }

  @Post('upgrade-to-pj')
  upgradeToPj(
    @Headers('x-identity-id') identityId?: string,
    @Headers('x-org-id') headerOrgId?: string,
    @Body() dto?: UpgradeToPjDto,
  ) {
    const id = this.identityOrThrow(identityId);
    const orgId = this.customers.resolveOrgScope(headerOrgId, dto?.organizationId);
    return this.customers.upgradeToPj(id, { organizationId: orgId, cnpj: dto?.cnpj });
  }

  @Post('organizations')
  @HttpCode(HttpStatus.CREATED)
  createOrganization(
    @Headers('x-identity-id') identityId?: string,
    @Body() dto?: CreateOrganizationDto,
  ) {
    if (!dto) throw new BadRequestException('Corpo obrigatório');
    return this.customers.createOrganization(this.identityOrThrow(identityId), {
      razaoSocial: dto.razaoSocial,
      cnpj: dto.cnpj,
    });
  }

  @Get('organizations')
  listOrganizations(@Headers('x-identity-id') identityId?: string) {
    return this.customers.listOrganizations(this.identityOrThrow(identityId));
  }

  @Get('organizations/:orgId/members')
  listMembers(
    @Headers('x-identity-id') identityId?: string,
    @Headers('x-org-id') headerOrgId?: string,
    @Param('orgId') orgId?: string,
  ) {
    const scope = this.customers.resolveOrgScope(headerOrgId, orgId);
    if (!scope) throw new BadRequestException('orgId obrigatório');
    return this.customers.listMembers(this.identityOrThrow(identityId), scope);
  }

  @Post('organizations/:orgId/members/invite')
  @HttpCode(HttpStatus.CREATED)
  inviteMember(
    @Headers('x-identity-id') identityId?: string,
    @Headers('x-org-id') headerOrgId?: string,
    @Param('orgId') orgId?: string,
    @Body() dto?: InviteMemberDto,
  ) {
    const scope = this.customers.resolveOrgScope(headerOrgId, orgId);
    if (!scope) throw new BadRequestException('orgId obrigatório');
    if (!dto) throw new BadRequestException('Corpo obrigatório');
    return this.customers.inviteMember(this.identityOrThrow(identityId), scope, {
      identityId: dto.identityId,
      role: dto.role,
    });
  }

  @Patch('organizations/:orgId/members/:memberIdentityId')
  updateMember(
    @Headers('x-identity-id') identityId?: string,
    @Headers('x-org-id') headerOrgId?: string,
    @Param('orgId') orgId?: string,
    @Param('memberIdentityId') memberIdentityId?: string,
    @Body() dto?: UpdateMemberDto,
  ) {
    const scope = this.customers.resolveOrgScope(headerOrgId, orgId);
    if (!scope || !memberIdentityId) throw new BadRequestException('orgId/memberIdentityId obrigatórios');
    return this.customers.updateMember(this.identityOrThrow(identityId), scope, memberIdentityId, dto ?? {});
  }

  @Delete('organizations/:orgId/members/:memberIdentityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Headers('x-identity-id') identityId?: string,
    @Headers('x-org-id') headerOrgId?: string,
    @Param('orgId') orgId?: string,
    @Param('memberIdentityId') memberIdentityId?: string,
  ): Promise<void> {
    const scope = this.customers.resolveOrgScope(headerOrgId, orgId);
    if (!scope || !memberIdentityId) throw new BadRequestException('orgId/memberIdentityId obrigatórios');
    this.customers.removeMember(this.identityOrThrow(identityId), scope, memberIdentityId);
  }

  @Get('consents')
  listConsents(@Headers('x-identity-id') identityId?: string) {
    return this.customers.listConsents(this.identityOrThrow(identityId));
  }

  @Post('consents')
  @HttpCode(HttpStatus.CREATED)
  recordConsent(@Headers('x-identity-id') identityId?: string, @Body() dto?: RecordConsentDto) {
    if (!dto) throw new BadRequestException('Corpo obrigatório');
    return this.customers.recordConsent(this.identityOrThrow(identityId), {
      purpose: dto.purpose,
      version: dto.version,
      status: dto.status,
      policyHash: dto.policyHash,
    });
  }

  @Get('gdpr/export')
  exportData(@Headers('x-identity-id') identityId?: string) {
    return this.customers.exportData(this.identityOrThrow(identityId));
  }

  @Post('gdpr/anonymize')
  anonymize(@Headers('x-identity-id') identityId?: string) {
    return this.customers.anonymize(this.identityOrThrow(identityId));
  }
}

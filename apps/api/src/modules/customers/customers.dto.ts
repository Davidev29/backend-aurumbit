import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type {
  ConsentPurpose,
  ConsentStatus,
  MembershipRole,
  MembershipStatus,
} from './customers.types';

export class PatchMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;
}

export class UpgradeToPjDto {
  // Um dos dois identifica a organização alvo.
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  cnpj?: string;
}

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  razaoSocial!: string;

  // Dígitos (com ou sem máscara); só hash+last4 são persistidos.
  @IsString()
  @IsNotEmpty()
  @MaxLength(18)
  cnpj!: string;
}

export class InviteMemberDto {
  @IsString()
  @IsNotEmpty()
  identityId!: string;

  @IsOptional()
  @IsIn(['OWNER', 'ADMIN', 'FINANCE', 'MEMBER'])
  role?: MembershipRole;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(['OWNER', 'ADMIN', 'FINANCE', 'MEMBER'])
  role?: MembershipRole;

  @IsOptional()
  @IsIn(['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED'])
  status?: MembershipStatus;
}

export class RecordConsentDto {
  @IsIn(['TERMS', 'PRIVACY', 'MARKETING'])
  purpose!: ConsentPurpose;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  version!: string;

  @IsIn(['GRANTED', 'WITHDRAWN'])
  status!: ConsentStatus;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  policyHash!: string;
}

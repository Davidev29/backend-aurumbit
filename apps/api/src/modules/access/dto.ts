import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CheckAccessQueryDto {
  @IsIn(['CUSTOMER', 'ORGANIZATION'])
  ownerType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  ownerId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  productId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  featureCode!: string;

  // Fase 8: canal requisitado (WEB | DESKTOP). Omitido = sem gating
  // (legado). Servidor filtra entitlements por ele — UI nunca autoriza sozinha.
  @IsOptional()
  @IsIn(['WEB', 'DESKTOP'])
  channel?: string;
}

export class CheckBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckAccessQueryDto)
  checks!: CheckAccessQueryDto[];
}

export class ContractItemInput {
  // IDs opacos cross-DB (products.ProductPlan.id / products.Product.id).
  @IsString()
  @MinLength(1)
  planId!: string;

  @IsString()
  @MinLength(1)
  productId!: string;

  // CONGELADO na contratação; sem endpoint de update.
  @IsInt()
  @Min(0)
  unitPriceCents!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class CreateContractDto {
  @IsIn(['CUSTOMER', 'ORGANIZATION'])
  ownerType!: string;

  @IsString()
  @MinLength(1)
  ownerId!: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE'])
  status?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContractItemInput)
  items!: ContractItemInput[];
}

export class UpdateContractStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'])
  status!: string;

  @IsString()
  @MinLength(1)
  actor!: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

export class UpdateItemStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'])
  status!: string;

  @IsString()
  @MinLength(1)
  actor!: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

export class UpsertEntitlementDto {
  @IsIn(['CUSTOMER', 'ORGANIZATION'])
  ownerType!: string;

  @IsString()
  @MinLength(1)
  ownerId!: string;

  @IsString()
  @MinLength(1)
  productId!: string;

  @IsString()
  @MinLength(1)
  featureCode!: string;

  @IsIn(['CONTRACT', 'SUBSCRIPTION', 'LICENSE', 'BONUS'])
  origin!: string;

  @IsString()
  @MinLength(1)
  originId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'GRACE', 'SUSPENDED', 'EXPIRED', 'REVOKED'])
  status?: string;

  @IsOptional()
  @IsString()
  quotaValue?: string;

  // Fase 8: canal denormalizado da feature (WEB | DESKTOP | BOTH).
  // Omitido = BOTH (legado).
  @IsOptional()
  @IsIn(['WEB', 'DESKTOP', 'BOTH'])
  channel?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsDateString()
  graceUntil?: string;
}

export class GrantBonusDto {
  @IsIn(['CUSTOMER', 'ORGANIZATION'])
  ownerType!: string;

  @IsString()
  @MinLength(1)
  ownerId!: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  featureCode?: string;

  @IsString()
  @MinLength(10)
  reason!: string;

  // null/omitido = vitalícia (revogável).
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsString()
  @MinLength(1)
  grantedBy!: string;
}

export class RevokeBonusDto {
  @IsString()
  @MinLength(1)
  actor!: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

export class LogAdjustmentDto {
  @IsString()
  @MinLength(1)
  actor!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  action!: string;

  @IsOptional()
  @IsIn(['ENTITLEMENT', 'BONUS', 'CONTRACT'])
  targetType?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

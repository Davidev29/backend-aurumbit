import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE'])
  status?: string;

  // Limite padrão de máquinas por licença (admin/BFF validam 1..100).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  machinesAllowed?: number;
}

export class CreateVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changelog?: string;
}

export class PlanFeatureInput {
  @IsString()
  @MinLength(1)
  featureCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  value?: string;
}

export class CreatePlanDto {
  @IsString()
  @MinLength(1)
  productCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  // IMUTÁVEL: não existe endpoint de update de preço; novo preço = nova linha.
  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsIn(['MONTH', 'YEAR', 'ONE_TIME'])
  billingInterval!: string;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureInput)
  features?: PlanFeatureInput[];
}

export class ArchivePlanDto {
  // Linha sucessora (nova linha de catálogo que substitui esta).
  @IsOptional()
  @IsString()
  @MinLength(1)
  supersededBy?: string;
}

export class CreateFeatureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(['BOOLEAN', 'QUOTA', 'LIMIT'])
  kind!: string;

  // Fase 8: canal da capability. Omitido = BOTH (legado, sem gating).
  @IsOptional()
  @IsIn(['WEB', 'DESKTOP', 'BOTH'])
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;
}

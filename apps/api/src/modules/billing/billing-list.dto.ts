import { Expose, Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Leituras paginadas do Billing core (aditivo — DTOs de escrita em
// `./billing.dto.ts` preservados). Fio snake_case via @Expose (padrão
// Fase 3/4); TS camelCase. Cursor = id opaco (nunca offset); teto 100.

export class ListInvoicesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsDateString()
  @Expose({ name: 'due_from' })
  dueFrom?: string;

  @IsOptional()
  @IsDateString()
  @Expose({ name: 'due_to' })
  dueTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor?: string;
}

export class ListSubscriptionsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor?: string;
}

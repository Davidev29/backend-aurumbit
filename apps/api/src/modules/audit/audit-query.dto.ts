import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Expose, Type } from 'class-transformer';

// Leitura append-only de `audit.audit_events` (só SELECT). Fio snake_case;
// cursor = id opaco (nunca offset); teto 100. Sem dump sem limite? Com
// limite default 20 sempre há teto — filtros todos opcionais.
export class ListAuditEventsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  actor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  resource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'correlation_id' })
  correlationId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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

import { Expose } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

// DTOs do fluxo financeiro canônico (Fase 5, arquivo NOVO; `finance.controller.ts`
// stub preservado). TS camelCase, fio snake_case via @Expose onde aplicável.

export class IngestPaymentConfirmedDto {
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  @Expose({ name: 'event_id' })
  eventId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'org_id' })
  orgId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'external_id' })
  externalId!: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsString()
  @MinLength(1)
  @Expose({ name: 'paid_at' })
  paidAt!: string;
}

export class CreateReceivableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'org_id' })
  orgId!: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'external_id' })
  externalId?: string;

  /** `previsto` | `pendente` (default `pendente`). */
  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsString()
  @Expose({ name: 'due_date' })
  dueDate?: string;
}

export class MarkReceivedDto {
  @IsOptional()
  @IsString()
  @Expose({ name: 'paid_at' })
  paidAt?: string;

  @IsOptional()
  @IsString()
  @Expose({ name: 'event_id' })
  eventId?: string;
}

export class CreatePayableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'org_id' })
  orgId!: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsString()
  @Expose({ name: 'due_date' })
  dueDate?: string;
}

export class MarkPaidDto {
  @IsOptional()
  @IsString()
  @Expose({ name: 'paid_at' })
  paidAt?: string;

  @IsOptional()
  @IsString()
  @Expose({ name: 'event_id' })
  eventId?: string;
}

export class ComputeProjectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'org_id' })
  orgId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Expose({ name: 'horizon_days' })
  horizonDays?: number;
}

export class GrantFinanceReadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'org_id' })
  orgId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  grantee!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'actor_id' })
  actorId?: string;
}

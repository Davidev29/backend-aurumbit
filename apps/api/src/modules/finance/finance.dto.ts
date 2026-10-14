import { Expose } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// DTOs Finance core (Fase 5). TS camelCase, fio snake_case via @Expose
// (padrão Fase 3/4). Org sempre via header `x-org-id` (guard), nunca no body.

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^[A-Z0-9_-]+$/)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsString()
  @Matches(/^(INCOME|EXPENSE)$/)
  type!: string;
}

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^[A-Z0-9_-]+$/)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsString()
  @Matches(/^(CASH|BANK|ASAAS_WALLET)$/)
  type!: string;
}

export class CreateReceivableDto {
  @IsString()
  @Matches(/^(INVOICE|MANUAL)$/)
  @Expose({ name: 'source_type' })
  sourceType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'source_id' })
  sourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'category_id' })
  categoryId?: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsDateString()
  @Expose({ name: 'due_date' })
  dueDate!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(PREVISTO|PENDENTE)$/)
  status?: string;
}

export class CreatePayableDto {
  @IsString()
  @Matches(/^(REFUND|MANUAL|SUPPLIER)$/)
  @Expose({ name: 'source_type' })
  sourceType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'source_id' })
  sourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'category_id' })
  categoryId?: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsDateString()
  @Expose({ name: 'due_date' })
  dueDate!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(PREVISTO|PENDENTE)$/)
  status?: string;
}

export class MarkReceivedDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'account_id' })
  accountId!: string;

  @IsOptional()
  @IsDateString()
  @Expose({ name: 'received_at' })
  receivedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^(ASAAS|MANUAL)$/)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'external_id' })
  externalId?: string;
}

export class MarkPaidDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'account_id' })
  accountId!: string;

  @IsOptional()
  @IsDateString()
  @Expose({ name: 'paid_at' })
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^(ASAAS|MANUAL)$/)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'external_id' })
  externalId?: string;
}

export class FinanceListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class TransactionListQueryDto extends FinanceListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'account_id' })
  accountId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(INCOME|EXPENSE)$/)
  kind?: string;
}

export class OverviewQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

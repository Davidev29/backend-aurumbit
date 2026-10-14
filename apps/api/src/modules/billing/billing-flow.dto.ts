import { Expose, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

// DTOs do fluxo canônico Order→Invoice→Payment + webhook Asaas mock (Fase 4,
// workstream workers/outbox). Separados de `billing.dto.ts` (core do outro
// workstream — não reescrito). TS camelCase, fio snake_case via @Expose.

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'customer_id' })
  customerId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'product_id' })
  productId!: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;
}

export class AsaasPaymentDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsOptional()
  value?: number;

  @IsOptional()
  @IsString()
  @Expose({ name: 'confirmedDate' })
  confirmedDate?: string;

  @IsOptional()
  @IsString()
  @Expose({ name: 'dueDate' })
  dueDate?: string;
}

export class AsaasWebhookDto {
  @IsString()
  @MinLength(1)
  event!: string;

  @ValidateNested()
  @Type(() => AsaasPaymentDto)
  payment!: AsaasPaymentDto;

  @IsOptional()
  version?: number;

  @IsOptional()
  @IsString()
  @Expose({ name: 'occurredAt' })
  occurredAt?: string;
}

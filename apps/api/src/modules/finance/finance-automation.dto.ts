import { Expose } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Automação financeira (despesas via Asaas Bill Payments + receitas via
// cobrança automática). TS camelCase, fio snake_case via @Expose
// (padrão Fase 3/4/5). Org sempre via `x-org-id` (guard), nunca no body.

export class CreateExpenseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Expose({ name: 'supplier' })
  supplier!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'category_id' })
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'account_id' })
  accountId?: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsDateString()
  @Expose({ name: 'due_date' })
  dueDate!: string;

  /** Data de pagamento/agendamento (ISO). Ausente = no vencimento. */
  @IsOptional()
  @IsDateString()
  @Expose({ name: 'schedule_date' })
  scheduleDate?: string;

  /** Linha digitável / código de barras (44/47/48 dígitos, com ou sem máscara). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Expose({ name: 'barcode' })
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Expose({ name: 'description' })
  description?: string;

  /** `true` = tenta pagar via Conta Asaas (Bill Payments) quando suportado. */
  @IsOptional()
  @IsBoolean()
  @Expose({ name: 'pay_via_asaas' })
  payViaAsaas?: boolean;
}

export class CreateAutoReceivableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Expose({ name: 'customer_name' })
  customerName!: string;

  /** Customer no Asaas (`cus_*`) p/ emitir a cobrança automática. */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'asaas_customer_id' })
  asaasCustomerId!: string;

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
  @Matches(/^(PIX|BOLETO|CREDIT_CARD|UNDEFINED)$/)
  @Expose({ name: 'billing_type' })
  billingType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Expose({ name: 'description' })
  description?: string;
}

import { Expose } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// DTOs Billing core (Fase 4, outro workstream — NÃO reescrever: este arquivo é
// compartilhado). TS camelCase, fio snake_case via @Expose (padrão Fase 3).

export class SyncCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'user_id' })
  userId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'asaas_customer_id' })
  asaasCustomerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Expose({ name: 'cpf_cnpj' })
  cpfCnpj?: string;
}

export class CreateInvoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'customer_id' })
  customerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'subscription_id' })
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'order_id' })
  orderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'asaas_invoice_id' })
  asaasInvoiceId?: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Expose({ name: 'discount_cents' })
  discountCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Expose({ name: 'fine_cents' })
  fineCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Expose({ name: 'interest_cents' })
  interestCents?: number;

  @IsOptional()
  @IsString()
  @Expose({ name: 'due_date' })
  dueDate?: string;

  // Fase 8: intervalo comercial (MONTH | YEAR | ONE_TIME). Omitido = legado
  // (sem validação comercial; checkout sempre informa).
  @IsOptional()
  @IsString()
  @Expose({ name: 'billing_interval' })
  billingInterval?: string;

  // Fase 8: refs opacas do pedido (origem: products). Permitem ao worker
  // montar issue-from-payment sem leitura cross-schema.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'product_id' })
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'plan_ref' })
  planRef?: string;
}

export class CancelDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class CreateSubscriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'customer_id' })
  customerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'asaas_subscription_id' })
  asaasSubscriptionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'plan_ref' })
  planRef?: string;

  // Fase 8: intervalo comercial (validado no service: MONTH | YEAR | ONE_TIME).
  @IsOptional()
  @IsString()
  @Expose({ name: 'billing_interval' })
  billingInterval?: string;

  @IsOptional()
  @IsString()
  @Expose({ name: 'current_period_start' })
  currentPeriodStart?: string;

  @IsOptional()
  @IsString()
  @Expose({ name: 'current_period_end' })
  currentPeriodEnd?: string;
}

export class RegisterPaymentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'external_id' })
  externalId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'customer_id' })
  customerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'invoice_id' })
  invoiceId?: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^[A-Z_]+$/)
  method?: string;
}

export class ConfirmPaymentDto {
  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsString()
  @Expose({ name: 'paid_at' })
  paidAt!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsString()
  @Expose({ name: 'occurred_at' })
  occurredAt?: string;
}

export class CreateRefundDto {
  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'external_id' })
  externalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// Fase 8: pedido de checkout pós-pagamento real. O cliente gera `orderId`
// (Idempotency-Key natural): replay do mesmo pedido retorna a mesma sessão,
// nunca duplica fatura/cobrança. Sessão nasce PENDING — `done` só com licença.
export class CheckoutOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'order_id' })
  orderId!: string;

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

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Expose({ name: 'plan_ref' })
  planRef!: string;

  @IsIn(['MONTH', 'YEAR', 'ONE_TIME'])
  @Expose({ name: 'billing_interval' })
  billingInterval!: string;

  @IsInt()
  @Min(1)
  @Expose({ name: 'amount_cents' })
  amountCents!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_]+$/)
  @MaxLength(16)
  @Expose({ name: 'payment_method' })
  paymentMethod?: string;
}

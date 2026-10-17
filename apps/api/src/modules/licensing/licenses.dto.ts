import { Type } from 'class-transformer';
import {
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

// DTOs do Licensing core — ciclo de vida da licença (Fase 3).
// Arquivo separado de `./dto` (devices/offline-token, outro workstream)
// para evitar edição concorrente no mesmo módulo.
// IDs cross-schema são opacos (customers, products, access) — sem validação
// de existência aqui (sem FK cross-schema).

// Fase 8: snapshot {code, channel} congelado na emissão (offline-JWT `ch` +
// entitlements por feature no consumidor access). Omitido = legado (curinga).
export class LicenseFeatureSnapshot {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsOptional()
  @IsIn(['WEB', 'DESKTOP', 'BOTH'])
  channel?: string;
}

export class IssueLicenseDto {
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

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  planId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  contractItemId?: string;

  @IsIn(['monthly', 'annual', 'lifetime'])
  kind!: string;

  // Rótulo de exibição do titular (dispensado lookup cross-schema no BFF).
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  ownerLabel?: string;

  // TODO(Fase 4): starts_at = PaymentConfirmed (hook billing). Por ora o
  // emissor admin/system informa explicitamente; omitido = agora.
  // (Fase 8: issueFromPayment preenche startsAt = paidAt + features do plano.)
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LicenseFeatureSnapshot)
  features?: LicenseFeatureSnapshot[];
}

export class RenewLicenseDto {
  // Omitido = mesmo kind da licença anterior. `lifetime` como override =
  // upgrade (mensal/anual → perpétua). Renovar UMA lifetime não faz sentido:
  // barrado no service (409 LIFETIME_NO_RENEW).
  @IsOptional()
  @IsIn(['monthly', 'annual', 'lifetime'])
  kind?: string;
}

// Demo/promo/trial: chave sem conta Aurumbit (ativação só por chave).
// ownerType PROMO/GUEST com ownerId sentinela `promo:<batchId>` — sem
// migration (colunas String existentes). kind trial = horas/dias;
// infinite = lifetime (parceria). maxDevices default 1 p/ demo.
export class IssueTrialDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  productId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  planId?: string;

  // Quantidade de chaves do lote (1..100).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  qty?: number;

  // Máquinas por chave demo (default 1).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxDevices?: number;

  // Duração em horas (1h..8760h). Obrigatório salvo infinite=true.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  expiresInHours?: number;

  // Parceria infinita: emite lifetime (expiresAt/graceUntil null).
  @IsOptional()
  infinite?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  ownerLabel?: string;

  // Rótulo do lote p/ suporte (ex. "stand feira", "parceiro X").
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  note?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LicenseFeatureSnapshot)
  features?: LicenseFeatureSnapshot[];
}

export class LicenseReasonDto {
  // Motivo obrigatório (>=10 chars, padrão access Bonus/Adjustment).
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  // Licença sucessora (renovação com substituição): vai p/ o payload
  // `LicenseRevoked` do outbox (reconciliação pelo consumidor Access).
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  replacedBy?: string;
}

/**
 * Prorrogação IN-PLACE (`POST /v1/licenses/:id/extend`): estende a MESMA
 * licença (preserva id/chave_hash/vínculos de máquina), diferente do
 * `renew`, que cria licença nova. `months` em meses-calendário UTC.
 * Motivo obrigatório no mesmo padrão de `LicenseReasonDto` (>=10 chars).
 */
export class ExtendLicenseDto {
  @IsInt()
  @Min(1)
  @Max(12)
  months!: number;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class RevealLicenseDto {
  // Motivo opcional do reveal — vai p/ trilha `license.reveal` com o ator.
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class ListLicensesQueryDto {
  // Filtro de titular (sem dump bulk). ownerType/ownerId opcionais p/
  // agregar por produto no BFF (`GET /v1/licenses?productId=`); sem
  // nenhum filtro a listagem é recusada no service (400).
  // PROMO/GUEST = lotes demo sem conta (trial-issue).
  @IsOptional()
  @IsIn(['CUSTOMER', 'ORGANIZATION', 'PROMO', 'GUEST'])
  ownerType?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  ownerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  productId?: string;

  // Atalho do titular: `?mine=1` lista as licenças CUSTOMER do chamador
  // (`ownerId` = identityId do JWT — convenção documentada em ACTIVATION.md).
  @IsOptional()
  @IsIn(['1', 'true'])
  mine?: string;

  // Filtro por status EFETIVO (active/grace/expired derivados na leitura).
  @IsOptional()
  @IsIn(['pending_payment', 'active', 'grace', 'suspended', 'expired', 'revoked'])
  status?: string;
}

// Fase 8: emissão via PaymentConfirmed (interno worker→API).
// billingInterval espelha o checkout (MONTH | YEAR | ONE_TIME → kind).
// amountCents vai na URL do evento, não no DTO (vem do pagamento confirmado).
export class IssueFromPaymentDto {
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  eventId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  paymentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  orderId?: string;

  @IsIn(['CUSTOMER', 'ORGANIZATION'])
  ownerType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  ownerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerLabel?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  productId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  planId?: string;

  @IsIn(['MONTH', 'YEAR', 'ONE_TIME'])
  billingInterval!: string;

  @IsDateString()
  paidAt!: string;

  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LicenseFeatureSnapshot)
  features?: LicenseFeatureSnapshot[];
}

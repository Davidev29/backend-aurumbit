import { Type } from 'class-transformer';
import { Expose } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// DTOs Fase 3 — unificados (reparo Licensing 2026-10-10).
//
// DECISÃO DE PADRÃO (documentada p/ auditoria):
// - TS canônico em camelCase; fio (JSON/query) em snake_case via
//   `@Expose({ name })`. `main.ts` usa `ValidationPipe(transform:true)`,
//   então `device_hash` ↔ `deviceHash` etc. convertem automaticamente.
// - Device DTOs espelham `devices.dto.ts` (contrato com o app); os nomes de
//   classe aqui são os que `devices.controller.ts` / `offline-token.controller.ts`
//   importam de `./dto`. `devices.dto.ts` é preservado (outro workstream) —
//   duplicação temporária até reconciliação dos módulos.
// - `status` persistido em minúsculo (padrão core: `license-keys.ts` /
//   `licenses.service.ts`): pending_payment/active/grace/suspended/expired/revoked.
//   `reason` de decisão (CheckReason/OnlineDecision/OfflineReason) permanece em
//   MAIÚSCULO por ser enum de contrato com o app (ex. DEVICE_BLOCKED,
//   CLONE_SUSPECT, OFFLINE_EXPIRED) — ver specs.
// - CheckReason estendido (não mapeado): OFFLINE_EXPIRED e
//   TOKEN_VERSION_MISMATCH vêm de `evaluateOfflineStatus` (PROJECT.md §1:
//   o cliente precisa distinguir EXPIRED de OFFLINE_EXPIRED); CLONE_SUSPECT
//   vem do fluxo online `devices.service`. Mapear para reasons existentes
//   perderia semântica, então estende.
// `paidAt`/`now`/`iat` são âncoras de tempo test-only: recusadas em produção.

const HASH64 = /^[0-9a-f]{64}$/;

export class IssueLicenseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  ownerId!: string;

  // Rótulo de exibição do titular (dispensa lookup cross-DB na UI).
  // Persiste no record in-memory (+ coluna futura `owner_label` no PG).
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

  @IsOptional()
  @IsIn([1, 12])
  months?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxDevices?: number;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  actor?: string;
}

export class RenewLicenseDto {
  @IsOptional()
  @IsIn([1, 12])
  months?: number;

  @IsOptional()
  @IsDateString()
  now?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  actor?: string;
}

export class RevokeLicenseDto {
  @IsString()
  @MinLength(1)
  actor!: string;

  @IsString()
  @MinLength(10)
  reason!: string;

  // Licença sucessora (renovação com substituição): vai p/ o metadata
  // do audit `license.revoke` (allowlist `replacedBy`) e p/ o history.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  replacedBy?: string;
}

export class RevealLicenseDto {
  @IsString()
  @MinLength(1)
  actor!: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

export class RotateLicenseDto {
  @IsString()
  @MinLength(1)
  actor!: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

export class LinkDeviceDto {
  /** Hash HMAC já calculado (hex 64). Preferir `app_instance_id` (servidor deriva). */
  @IsOptional()
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  @Expose({ name: 'device_hash' })
  deviceHash?: string;

  /** Id da instância do app — servidor deriva o HMAC (PROJECT.md §4). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'app_instance_id' })
  appInstanceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class UnlinkDeviceDto {
  @IsOptional()
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  @Expose({ name: 'device_hash' })
  deviceHash?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Expose({ name: 'app_instance_id' })
  appInstanceId?: string;
}

export class BlockDeviceDto {
  /** Presente no body da rota flow; ausente na rota `/:hash/block` (vai na URL). */
  @IsOptional()
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  @Expose({ name: 'device_hash' })
  deviceHash?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  actor?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class RotateDeviceDto {
  @IsString()
  @Matches(HASH64, { message: 'old_device_hash deve ser hex de 64 chars' })
  @Expose({ name: 'old_device_hash' })
  oldDeviceHash!: string;

  @IsString()
  @Matches(HASH64, { message: 'new_device_hash deve ser hex de 64 chars' })
  @Expose({ name: 'new_device_hash' })
  newDeviceHash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class ValidateDeviceDto {
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  @Expose({ name: 'device_hash' })
  deviceHash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  /** País aproximado (geo-IP, só em memória p/ sinal de clone). */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  country?: string;

  /** iat (epoch s) do token apresentado, p/ detecção de iat futuro. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  @Expose({ name: 'token_iat' })
  tokenIat?: number;

  /** Contador do token apresentado (rollback = clone). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  ctr?: number;
}

export class DeviceHashParamDto {
  @IsString()
  @Matches(HASH64, { message: 'hash deve ser hex de 64 chars' })
  hash!: string;
}

export class OfflineTokenQueryDto {
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  @Expose({ name: 'device_hash' })
  deviceHash!: string;
}

export class MintOfflineTokenDto {
  @IsOptional()
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  @Expose({ name: 'device_hash' })
  deviceHash?: string;

  @IsOptional()
  @IsDateString()
  iat?: string;
}

export class OfflineCheckDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsOptional()
  @IsDateString()
  now?: string;
}

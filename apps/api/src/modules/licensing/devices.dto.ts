import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

// DTOs dos devices/offline-token (Fase 3, workstream devices).
// Arquivo separado do `dto.ts` do License-core (outro workstream) p/ evitar
// colisão. Rotas: POST :id/devices/link|unlink|rotate, GET :id/devices,
// POST :id/devices/:hash/block, POST :id/validate, GET :id/offline-token.

const HASH64 = /^[0-9a-f]{64}$/;

export class LinkDeviceDto {
  /** Hash HMAC já calculado (hex 64). Preferir `app_instance_id` (servidor deriva). */
  @IsOptional()
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  device_hash?: string;

  /** Id da instância do app — servidor deriva o HMAC (PROJECT.md §4). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  app_instance_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class UnlinkDeviceDto {
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  device_hash!: string;
}

export class RotateDeviceDto {
  @IsString()
  @Matches(HASH64, { message: 'old_device_hash deve ser hex de 64 chars' })
  old_device_hash!: string;

  @IsString()
  @Matches(HASH64, { message: 'new_device_hash deve ser hex de 64 chars' })
  new_device_hash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class BlockDeviceDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ValidateDeviceDto {
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  device_hash!: string;

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
  token_iat?: number;

  /** Contador do token apresentado (rollback = clone). */
  @IsOptional()
  @IsInt()
  @Min(0)
  ctr?: number;
}

export class OfflineTokenQueryDto {
  @IsString()
  @Matches(HASH64, { message: 'device_hash deve ser hex de 64 chars' })
  device_hash!: string;
}

/** Códigos de erro do domínio devices (contrato). */
export const DEVICE_ERRORS = [
  'DEVICE_LIMIT',
  'CLONE_SUSPECT',
  'DEVICE_BLOCKED',
  'UNKNOWN_DEVICE',
  'ROTATED_EXPIRED',
  'EXPIRED',
] as const;

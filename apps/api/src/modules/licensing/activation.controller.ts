import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  Logger,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { DeviceConflictError, DeviceLimitError, DevicesService } from './devices.service';
import { sha256Hex } from './license-keys';
import { LicensesService } from './licenses.service';
import { OfflineTokenService } from './offline-token.service';

export class ActivateByKeyDto {
  /** Chave `AURUM-XXXX-XXXX-XXXX` (nunca logada, nunca retornada). */
  @IsString()
  @MinLength(10)
  @MaxLength(64)
  @Matches(/^AURUM-[A-Z0-9-]+$/i, { message: 'formato de chave inválido' })
  key!: string;

  /** Id da instância do app — o servidor deriva o HMAC do device. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  app_instance_id?: string;

  /**
   * IP local da máquina, enviado pelo app (bonificação/promo: o limite conta
   * máquinas distintas por IP). Ausente = IP observado da conexão.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

function clientIp(req: any): string | undefined {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req?.ip;
}

// Ativação pelo instalador — modo B ("digitar a chave").
// Modo A ("entrar na conta", recomendado) vive no BFF (`POST /api/me/licenses/activate`),
// que resolve e-mail→licenças e chama link/offline-token com o Bearer da sessão.
// Pública com rate-limit global (preset `licenseReveal`); sem PII em log.
@Controller('licenses')
export class ActivationController {
  private readonly logger = new Logger(ActivationController.name);

  constructor(
    private readonly licenses: LicensesService,
    private readonly devices: DevicesService,
    private readonly offline: OfflineTokenService,
  ) {}

  @Public()
  @Post('activate-by-key')
  @HttpCode(200)
  async activateByKey(@Body() dto: ActivateByKeyDto, @Req() req: any) {
    const found = await this.licenses.findByKeyHash(sha256Hex(dto.key.trim()));
    if (!found) {
      // Genérico de propósito (anti-enumeração: igual a chave inexistente).
      throw new NotFoundException({ code: 'KEY_INVALID', message: 'Chave inválida.' });
    }
    if (found.status !== 'active' && found.status !== 'grace') {
      throw new ForbiddenException({
        code: 'LICENSE_INACTIVE',
        message: `Licença com status ${found.status}.`,
      });
    }

    let device: { device_hash: string; created: boolean };
    try {
      const out = await this.devices.linkDevice(found.id, {
        app_instance_id: dto.app_instance_id,
        label: dto.label,
        ip: dto.ip ?? clientIp(req),
      });
      device = { device_hash: out.device.device_hash, created: out.created };
    } catch (e: unknown) {
      if (e instanceof DeviceLimitError) {
        throw new ConflictException({
          code: e.code,
          message: e.message,
          maxDevices: true,
        });
      }
      if (e instanceof DeviceConflictError) {
        if (e.code === 'DEVICE_BLOCKED') {
          throw new ForbiddenException({ code: e.code, message: e.message });
        }
        throw new ConflictException({ code: e.code, message: e.message });
      }
      throw e;
    }

    try {
      const token = await this.offline.mint(found.id, device.device_hash);
      this.logger.log(
        JSON.stringify({
          event: 'license.activate',
          mode: 'key',
          licenseId: found.id,
          created: device.created,
          at: new Date().toISOString(),
        }),
      );
      return {
        mode: 'key',
        licenseId: found.id,
        keyMasked: found.keyMasked,
        productId: found.productId,
        planId: found.planId,
        expiresAt: found.expiresAt,
        graceUntil: found.graceUntil,
        device_hash: device.device_hash,
        deviceCreated: device.created,
        offlineToken: token.token,
        off_exp: token.off_exp,
        token_version: token.token_version,
      };
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && 'status' in e) {
        const err = e as { code: string; status: number; message: string };
        throw new HttpException({ code: err.code, message: err.message }, err.status);
      }
      throw e;
    }
  }
}

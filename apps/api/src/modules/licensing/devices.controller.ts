import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DeviceConflictError, DeviceLimitError, DevicesService, LicenseNotFoundError } from './devices.service';
import {
  BlockDeviceDto,
  DeviceHashParamDto,
  LinkDeviceDto,
  RotateDeviceDto,
  UnlinkDeviceDto,
  ValidateDeviceDto,
} from './dto';

// Devices da licença (Fase 3). Rotas autenticadas pela cadeia padrão da plataforma,
// exceto `validate` (pública — o app instalado no modo chave não tem JWT de usuário;
// a credencial é o `device_hash` HMAC, imperscrutável sem o segredo do servidor,
// + rate-limit `devicePoll`); device-key auth dedicada é fase futura.
// `validate`/`offline-token` exigem online.
// Rotas Express-safe: `/link` ≡ `:link` da especificação (mesma semântica).

function clientIp(req: Request, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip;
}

function mapError(e: unknown): never {
  if (e instanceof LicenseNotFoundError) throw new NotFoundException({ code: e.code, message: e.message });
  if (e instanceof DeviceLimitError) {
    throw new ConflictException({ code: e.code, message: e.message, maxDevices: true, devices: e.devices });
  }
  if (e instanceof DeviceConflictError) {
    const status =
      e.code === 'DEVICE_BLOCKED' ? new ForbiddenException({ code: e.code, message: e.message }) : null;
    if (status) throw status;
    if (e.code === 'UNKNOWN_DEVICE') throw new NotFoundException({ code: e.code, message: e.message });
    throw new ConflictException({ code: e.code, message: e.message });
  }
  throw e;
}

@Controller('licenses')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get(':id/devices')
  list(@Param('id') id: string) {
    return this.devices.listDevices(id).catch(mapError).then((devices) => ({ licenseId: id, devices }));
  }

  @Post(':id/devices/link')
  @HttpCode(201)
  async link(@Param('id') id: string, @Body() dto: LinkDeviceDto, @Req() req: Request) {
    try {
      const out = await this.devices.linkDevice(
        id,
        { device_hash: dto.deviceHash, app_instance_id: dto.appInstanceId, label: dto.label, ip: dto.ip ?? clientIp(req) },
      );
      return { licenseId: id, ...out };
    } catch (e) {
      mapError(e);
    }
  }

  @Post(':id/devices/unlink')
  @HttpCode(200)
  async unlink(@Param('id') id: string, @Body() dto: UnlinkDeviceDto) {
    try {
      const hash = this.devices.resolveDeviceHash(id, {
        device_hash: dto.deviceHash,
        app_instance_id: dto.appInstanceId,
      });
      return { licenseId: id, ...(await this.devices.unlinkDevice(id, hash)) };
    } catch (e) {
      mapError(e);
    }
  }

  @Post(':id/devices/rotate')
  @HttpCode(200)
  async rotate(@Param('id') id: string, @Body() dto: RotateDeviceDto, @Req() req: Request) {
    try {
      const out = await this.devices.rotateDevice(
        id,
        { oldHash: dto.oldDeviceHash, newHash: dto.newDeviceHash, label: dto.label, ip: clientIp(req) },
      );
      return {
        licenseId: id,
        old_device: out.oldDevice,
        new_device: out.newDevice,
        dual_accept_until: out.dualAcceptUntil.toISOString(),
      };
    } catch (e) {
      mapError(e);
    }
  }

  @Post(':id/devices/:hash/block')
  @HttpCode(200)
  async block(@Param('id') id: string, @Param() p: DeviceHashParamDto, @Body() dto: BlockDeviceDto) {
    try {
      const device = await this.devices.blockDevice(id, p.hash, dto.reason);
      return { licenseId: id, device };
    } catch (e) {
      mapError(e);
    }
  }

  /** Validação online com detecção de clone (200 sempre; o corpo diz allow/deny). */
  @Public()
  @Post(':id/validate')
  @HttpCode(200)
  async validate(@Param('id') id: string, @Body() dto: ValidateDeviceDto, @Req() req: Request) {
    const decision = await this.devices.validateOnline(
      id,
      {
        deviceHash: dto.deviceHash,
        ip: clientIp(req, dto.ip),
        country: dto.country,
        tokenIatS: dto.tokenIat,
        ctr: dto.ctr,
      },
    );
    if (decision.allow) {
      return { licenseId: id, device_hash: dto.deviceHash, allow: true, degraded: decision.degraded, reason: decision.reason };
    }
    const code = decision.reason;
    // O corpo carrega o motivo; HTTP 200 mantém o app offline-tolerante (sem retry-storm).
    return { licenseId: id, device_hash: dto.deviceHash, allow: false, degraded: false, reason: code, errorCode: code };
  }
}

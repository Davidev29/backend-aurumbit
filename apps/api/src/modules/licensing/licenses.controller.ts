import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminStubGuard } from '../access/admin.guard';
import {
  BlockDeviceDto,
  IssueLicenseDto,
  LinkDeviceDto,
  MintOfflineTokenDto,
  OfflineCheckDto,
  RenewLicenseDto,
  RevealLicenseDto,
  RotateLicenseDto,
  RevokeLicenseDto,
  UnlinkDeviceDto,
} from './dto';
import { LicensingFlowService } from './licensing-flow.service';

// Superfície Fase 3 (arquivo NOVO; `licensing.controller.ts` stub preservado).
// Guarda stub `x-role: admin` como `access/admin` (TODO RBAC real, PROJECT §3).
// Chave plaintext trafega SÓ em issue/reveal/rotate (uma vez); resto é máscara.
@Controller('licenses')
@UseGuards(AdminStubGuard)
export class LicensesController {
  constructor(private readonly flow: LicensingFlowService) {}

  @Post()
  issue(@Body() dto: IssueLicenseDto) {
    return this.flow.issue(dto);
  }

  // Leituras agregadas do BFF (antes de `:id`: dois segmentos, sem colisão).
  @Get('by-product/:productId')
  byProduct(@Param('productId') productId: string) {
    return this.flow.listByProduct(productId);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.flow.getHistory(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.flow.getMasked(id);
  }

  @Post(':id/renew')
  renew(@Param('id') id: string, @Body() dto: RenewLicenseDto) {
    return this.flow.renew(id, dto);
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string, @Body() dto: RevokeLicenseDto) {
    return this.flow.revoke(id, dto);
  }

  @Post(':id/reveal')
  reveal(@Param('id') id: string, @Body() dto: RevealLicenseDto) {
    return this.flow.reveal(id, dto);
  }

  @Post(':id/rotate')
  rotate(@Param('id') id: string, @Body() dto: RotateLicenseDto) {
    return this.flow.rotate(id, dto);
  }

  @Post(':id/devices/link')
  @HttpCode(200)
  link(@Param('id') id: string, @Body() dto: LinkDeviceDto) {
    return this.flow.linkDevice(id, dto);
  }

  @Post(':id/devices/unlink')
  @HttpCode(200)
  unlink(@Param('id') id: string, @Body() dto: UnlinkDeviceDto) {
    return this.flow.unlinkDevice(id, dto);
  }

  @Post(':id/devices/block')
  @HttpCode(200)
  block(@Param('id') id: string, @Body() dto: BlockDeviceDto) {
    return this.flow.blockDevice(id, dto);
  }

  @Get(':id/check')
  check(
    @Param('id') id: string,
    @Query('deviceHash') deviceHash?: string,
    @Query('now') now?: string,
  ) {
    return this.flow.check(id, deviceHash, now);
  }

  @Post(':id/offline-token')
  mintOffline(@Param('id') id: string, @Body() dto: MintOfflineTokenDto, @Query('now') now?: string) {
    return this.flow.mintOffline(id, dto, now);
  }

  @Post('offline/check')
  @HttpCode(200)
  checkOffline(@Body() dto: OfflineCheckDto) {
    return this.flow.checkOffline(dto);
  }
}

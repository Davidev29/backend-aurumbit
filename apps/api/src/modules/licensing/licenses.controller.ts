import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
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
// RBAC real via JWT: role `STAFF_ADMIN` obrigatória; escritas exigem MFA step-up.
// Chave plaintext trafega SÓ em issue/reveal/rotate (uma vez); resto é máscara.
@Controller('licenses')
@UseGuards(RolesGuard)
export class LicensesController {
  constructor(private readonly flow: LicensingFlowService) {}

  @Post()
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  issue(@Body() dto: IssueLicenseDto) {
    return this.flow.issue(dto);
  }

  // Leituras agregadas do BFF (antes de `:id`: dois segmentos, sem colisão).
  @Get('by-product/:productId')
  @Roles('STAFF_ADMIN')
  byProduct(@Param('productId') productId: string) {
    return this.flow.listByProduct(productId);
  }

  @Get(':id/history')
  @Roles('STAFF_ADMIN')
  history(@Param('id') id: string) {
    return this.flow.getHistory(id);
  }

  @Get(':id')
  @Roles('STAFF_ADMIN')
  get(@Param('id') id: string) {
    return this.flow.getMasked(id);
  }

  @Post(':id/renew')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  renew(@Param('id') id: string, @Body() dto: RenewLicenseDto) {
    return this.flow.renew(id, dto);
  }

  @Post(':id/revoke')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  revoke(@Param('id') id: string, @Body() dto: RevokeLicenseDto) {
    return this.flow.revoke(id, dto);
  }

  @Post(':id/reveal')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  reveal(@Param('id') id: string, @Body() dto: RevealLicenseDto) {
    return this.flow.reveal(id, dto);
  }

  @Post(':id/rotate')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  rotate(@Param('id') id: string, @Body() dto: RotateLicenseDto) {
    return this.flow.rotate(id, dto);
  }

  @Post(':id/devices/link')
  @HttpCode(200)
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  link(@Param('id') id: string, @Body() dto: LinkDeviceDto) {
    return this.flow.linkDevice(id, dto);
  }

  @Post(':id/devices/unlink')
  @HttpCode(200)
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  unlink(@Param('id') id: string, @Body() dto: UnlinkDeviceDto) {
    return this.flow.unlinkDevice(id, dto);
  }

  @Post(':id/devices/block')
  @HttpCode(200)
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  block(@Param('id') id: string, @Body() dto: BlockDeviceDto) {
    return this.flow.blockDevice(id, dto);
  }

  @Get(':id/check')
  @Roles('STAFF_ADMIN')
  check(
    @Param('id') id: string,
    @Query('deviceHash') deviceHash?: string,
    @Query('now') now?: string,
  ) {
    return this.flow.check(id, deviceHash, now);
  }

  @Post(':id/offline-token')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  mintOffline(@Param('id') id: string, @Body() dto: MintOfflineTokenDto, @Query('now') now?: string) {
    return this.flow.mintOffline(id, dto, now);
  }

  @Post('offline/check')
  @HttpCode(200)
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  checkOffline(@Body() dto: OfflineCheckDto) {
    return this.flow.checkOffline(dto);
  }
}

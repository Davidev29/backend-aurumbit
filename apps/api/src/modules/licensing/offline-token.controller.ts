import { Controller, Get, HttpException, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { OfflineTokenQueryDto } from './dto';
import { OfflineTokenService } from './offline-token.service';

// Emissão do offline JWT (Fase 3, PROJECT.md §1).
// GET /v1/licenses/:id/offline-token?device_hash= — exige online + device active.
// Pública no modo chave (mesmo fundamento do `validate`: sem JWT de usuário no
// app instalado; `device_hash` HMAC + rate-limit `devicePoll`); no modo conta o
// BFF chama com o Bearer da sessão (comportamento inalterado).
// Erros: 404 licença/device ausente, 403 expirado/bloqueado/clone, 409 device não-ativo.

@Controller('licenses')
export class OfflineTokenController {
  constructor(private readonly offline: OfflineTokenService) {}

  @Public()
  @Get(':id/offline-token')
  async issue(@Param('id') id: string, @Query() q: OfflineTokenQueryDto) {
    try {
      const out = await this.offline.mint(id, q.deviceHash);
      return { licenseId: id, device_hash: q.deviceHash, ...out };
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && 'status' in e) {
        const err = e as { code: string; status: number; message: string };
        throw new HttpException({ code: err.code, message: err.message }, err.status);
      }
      throw e;
    }
  }
}

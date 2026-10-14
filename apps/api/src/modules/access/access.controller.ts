import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { AccessCheckService } from './access-check.service';
import { CheckAccessQueryDto, CheckBatchDto } from './dto';

// Leitura quente do acesso. Pública nesta fase (chamada server-to-server pelo
// licensing/billing); TODO(Fase 2-auth): exigir service-token/JWT.
@Controller('access')
export class AccessController {
  constructor(private readonly checks: AccessCheckService) {}

  @Get('check')
  check(@Query() q: CheckAccessQueryDto) {
    return this.checks.check(q);
  }

  @Post('check-batch')
  @HttpCode(200)
  checkBatch(@Body() dto: CheckBatchDto) {
    // Limite 50 imposto pelo DTO (@ArrayMaxSize(50)).
    return this.checks.checkBatch(dto.checks).then((results) => ({ results }));
  }
}

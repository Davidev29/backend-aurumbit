import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LicenseReadGuard } from './admin.guard';
import { DevicesController } from './devices.controller';
import { ActivationController } from './activation.controller';
import { DevicesService } from './devices.service';
import { InMemoryLicenseStore, LICENSE_STORE } from './license-store';
import { LicenseQueryController } from './license-query.controller';
import { LicensesService } from './licenses.service';
import { LICENSING_POOL, createLicensingPool } from './licensing-pool.provider';
import { LicensingController } from './licensing.controller';
import { LicensingFlowService } from './licensing-flow.service';
import { OfflineTokenController } from './offline-token.controller';
import { OfflineTokenService } from './offline-token.service';
import { ProductLicensesController } from './product-licenses.controller';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { RevealRateLimitGuard } from './reveal.guard';

// Fase 3 — Licensing core (emissão/renovação/suspensão/revogação/reveal).
// Pool PG próprio (DATABASE_URL_LICENSING); sem acesso a outros domínios.
// Devices + offline-token registrados aqui (rotas sem conflito com o core).
// `LicensesController` (flow in-memory) NÃO registrado de propósito: mesmas
// rotas do core PG (POST /:id/renew/revoke/reveal) — sombrearia o core.
// Coberto pelo e2e isolado `test/offline.e2e-spec.ts`.
// `LicenseQueryController` expõe SÓ os GETs novos do BFF
// (`by-product/:productId`, `:id/history`, trilha in-memory) — sem colisão.
// `ProductLicensesController` expõe `GET /v1/products/:code/licenses`
// (estado ATUAL por produto, via PG + `toMasked`). Sem colisão com o
// ProductsModule: 2º segmento literal `licenses`.
@Module({
  imports: [AuditModule],
  controllers: [
    LicensingController,
    LicenseQueryController,
    ProductLicensesController,
    PromotionsController,
    DevicesController,
    OfflineTokenController,
    ActivationController,
  ],
  providers: [
    { provide: LICENSING_POOL, useFactory: createLicensingPool },
    { provide: LICENSE_STORE, useClass: InMemoryLicenseStore },
    LicenseReadGuard,
    RevealRateLimitGuard,
    LicensesService,
    LicensingFlowService,
    DevicesService,
    OfflineTokenService,
    PromotionsService,
  ],
})
export class LicensingModule {}

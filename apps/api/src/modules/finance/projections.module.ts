/**
 * Projeções financeiras (Fase 5) — módulo Nest.
 * Importado pelo FinanceModule (wiring aditivo; núcleo finance intacto).
 * Fonte default em memória (vazia); o dono do finance core troca
 * PROJECTION_SOURCE pelo adaptador Prisma/PG sem tocar nestes arquivos.
 */

import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectionsController } from './projections.controller';
import { FinanceProjectionsGuard, InternalProjectionKeyGuard } from './projections.guard';
import { ProjectionMetrics } from './projections.metrics';
import { PROJECTION_QUEUE, createProjectionQueue } from './projections.queue';
import { PROJECTION_SOURCE, InMemoryProjectionSource } from './projections.source';
import { PROJECTION_STORE, ProjectionJobRegistry, createSnapshotStore } from './projections.store';
import { ProjectionsService } from './projections.service';

@Module({
  controllers: [ProjectionsController],
  providers: [
    Reflector,
    ProjectionMetrics,
    ProjectionJobRegistry,
    FinanceProjectionsGuard,
    InternalProjectionKeyGuard,
    { provide: PROJECTION_SOURCE, useClass: InMemoryProjectionSource },
    { provide: PROJECTION_STORE, useFactory: createSnapshotStore },
    { provide: PROJECTION_QUEUE, useFactory: createProjectionQueue },
    ProjectionsService,
  ],
  exports: [ProjectionsService, PROJECTION_SOURCE, PROJECTION_STORE],
})
export class ProjectionsModule {}

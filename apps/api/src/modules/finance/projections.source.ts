/**
 * Projeções — portas de dados (Fase 5).
 *
 * O cálculo (`projections.compute.ts`) não lê banco: esta porta entrega
 * os insumos do período. O default em memória retorna lista vazia (o
 * snapshot sai zerado mas válido); o dono do finance core pluga o
 * adaptador Prisma/PG aqui sem tocar nas projeções.
 */

import { Injectable } from '@nestjs/common';
import type { ProjectionInputs, ProjectionPeriod } from './projections.compute';

export interface ProjectionSource {
  listInputs(period: ProjectionPeriod): Promise<ProjectionInputs>;
  /** Estimativa de volume p/ decidir inline vs 202 (cômputo >500ms). */
  estimateLoad(period: ProjectionPeriod): Promise<number>;
}

export const PROJECTION_SOURCE = 'FINANCE_PROJECTION_SOURCE';

const EMPTY: ProjectionInputs = { receivables: [], payables: [], subscriptions: [], transactions: [] };

/** Fonte default: vazia (nenhum título — snapshot zerado, válido). */
@Injectable()
export class InMemoryProjectionSource implements ProjectionSource {
  private inputs: ProjectionInputs = EMPTY;

  /** Testes/fixtures: injeta insumos (filtragem por data é do cálculo). */
  setInputs(inputs: ProjectionInputs): void {
    this.inputs = inputs;
  }

  async listInputs(_period: ProjectionPeriod): Promise<ProjectionInputs> {
    return this.inputs;
  }

  async estimateLoad(_period: ProjectionPeriod): Promise<number> {
    return (
      this.inputs.receivables.length +
      this.inputs.payables.length +
      this.inputs.subscriptions.length +
      this.inputs.transactions.length
    );
  }
}

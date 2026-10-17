import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AdminQueuesController } from './admin-queues.controller';
import { AdminCustomersController } from './admin-customers.controller';
import { CustomerPipelineService } from '../modules/customers/customer-pipeline.service';
import { CUSTOMERS_POOL, createCustomersPool } from '../modules/customers/customers-pool.provider';
import { STAFF_DIRECTORY, StaffGuard } from '../common/guards/staff.guard';
import { getSharedAuthPool } from '../modules/auth/auth-pool.provider';
import type { StaffDirectory } from '../common/guards/staff.guard';

// Fase 6 (aditivo): agrupa endpoints administrativos (`/admin/*`, admin-only).
// O funil de clientes (`/admin/customers`) precisa do pool do domínio
// customers e do diretório de staff (resolução de e-mail p/ a allowlist).
const customersPoolProvider = { provide: CUSTOMERS_POOL, useFactory: (): Pool => createCustomersPool() };

/**
 * Diretório de staff via `auth.user_identities`: o JWT não carrega PII
 * (LGPD §3), então a allowlist `ADMIN_STAFF_EMAILS` é conferida contra o
 * e-mail da identidade no banco. Sem pool (sem DATABASE_URL*) → `null` →
 * `StaffGuard` nega (fail-closed).
 */
const staffDirectoryProvider = {
  provide: STAFF_DIRECTORY,
  useFactory: (): StaffDirectory => ({
    async emailOf(identityId: string): Promise<string | null> {
      const pool = getSharedAuthPool();
      if (!pool) return null;
      const res = await pool.query<{ email_display: string }>(
        'SELECT email_display FROM auth.user_identities WHERE id = $1',
        [identityId],
      );
      return res.rows[0]?.email_display ?? null;
    },
  }),
};

@Module({
  controllers: [AdminQueuesController, AdminCustomersController],
  imports: [],
  providers: [customersPoolProvider, staffDirectoryProvider, CustomerPipelineService, StaffGuard],
  exports: [CustomerPipelineService],
})
export class AdminModule {}
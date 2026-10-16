import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { LoggerModule } from 'nestjs-pino';
import { GuardsModule } from './common/guards/guards.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { validateEnv } from './config/env.schema';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { AccessModule } from './modules/access/access.module';
import { DlqAdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { BillingReconcileModule } from './modules/billing/reconcile.module';
import { BillingWebhookModule } from './modules/billing/webhook.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { SupportModule } from './modules/support/support.module';
import { CustomersModule } from './modules/customers/customers.module';
import { FinanceModule } from './modules/finance/finance.module';
import { LicensingModule } from './modules/licensing/licensing.module';
import { ProductsModule } from './modules/products/products.module';
import { RetentionModule } from './modules/retention/retention.module';

@Module({
  imports: [
    // `envFilePath` explícito: o default (cwd-relativo) falhou silenciosamente
    // no dev Windows (pool PG viu vars parciais) — resolve a partir do módulo.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: [join(__dirname, '..', '..', '.env'), '.env'],
    }),
    // pino em JSON (sem pretty) — requisito T2. Correlação via x-correlation-id (ver main.ts).
    // TODO(T5): mover para libs/observability com /metrics.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        customProps: (req: any) => ({
          'x-correlation-id': req.headers?.['x-correlation-id'],
        }),
      },
    }),
    // Ordem APP_GUARD (cadeia documentada em docs/ADR-002-guards.md):
    // JwtAuthGuard → SessionGuard → MfaGuard → VerifiedEmailGuard →
    // RolesGuard → CustomerScopeGuard (registrados, nesta ordem, em GuardsModule).
    // GuardsModule vem antes dos domínios para que a cadeia exista antes das rotas.
    // Fase 6 (aditivo): RateLimitModule antes de GuardsModule para que o
    // GlobalRateLimitGuard proteja login/recovery/webhook antes da cadeia
    // de auth (só age nos 4 prefixos; resto = allow; /health/* excluído).
    RateLimitModule,
    GuardsModule,
    HealthModule,
    AdminModule,
    DlqAdminModule,
    AuthModule,
    CustomersModule,
    ProductsModule,
    AccessModule,
    LicensingModule,
    BillingModule,
    BillingWebhookModule,
    BillingReconcileModule,
    FinanceModule,
    AuditModule,
    CommunicationsModule,
    SupportModule,
    RetentionModule,
  ],
})
export class AppModule {}

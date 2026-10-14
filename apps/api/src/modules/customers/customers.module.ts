import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

// Fase 2 — domínio customers: perfis PF/PJ, organizações, memberships,
// consents versionados e GDPR. Store em memória no serviço até a fiação
// do PrismaClient (DB customers); sem dependência de auth/products/access.
@Module({ controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}

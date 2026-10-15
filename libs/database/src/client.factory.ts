import { PrismaClient as AuthPrismaClient } from '../../../node_modules/.prisma/auth';
import { PrismaClient as CustomersPrismaClient } from '../../../node_modules/.prisma/customers';
import { PrismaClient as ProductsPrismaClient } from '../../../node_modules/.prisma/products';
import { PrismaClient as AccessPrismaClient } from '../../../node_modules/.prisma/access';
import { PrismaClient as LicensingPrismaClient } from '../../../node_modules/.prisma/licensing';
import { PrismaClient as BillingPrismaClient } from '../../../node_modules/.prisma/billing';
import { PrismaClient as FinancePrismaClient } from '../../../node_modules/.prisma/finance';
import { PrismaClient as AuditPrismaClient } from '../../../node_modules/.prisma/audit';
import { PrismaClient as CommunicationsPrismaClient } from '../../../node_modules/.prisma/communications';

// Tokens NestJS para injeção (1 por schema no banco `aurumbit`, sem compartilhamento cross-schema).
export const AUTH_DB = 'AUTH_DB';
export const CUSTOMERS_DB = 'CUSTOMERS_DB';
export const PRODUCTS_DB = 'PRODUCTS_DB';
export const ACCESS_DB = 'ACCESS_DB';
export const LICENSING_DB = 'LICENSING_DB';
export const BILLING_DB = 'BILLING_DB';
export const FINANCE_DB = 'FINANCE_DB';
export const AUDIT_DB = 'AUDIT_DB';
export const COMMUNICATIONS_DB = 'COMMUNICATIONS_DB';

export type DatabaseClients = {
  auth: AuthPrismaClient;
  customers: CustomersPrismaClient;
  products: ProductsPrismaClient;
  access: AccessPrismaClient;
  licensing: LicensingPrismaClient;
  billing: BillingPrismaClient;
  finance: FinancePrismaClient;
  audit: AuditPrismaClient;
  communications: CommunicationsPrismaClient;
};

let cached: DatabaseClients | null = null;

// 9 PrismaClients, 1 por domínio (schemas no banco `aurumbit`). FKs intra-schema RESTRICT + exceção única (ADR-006); junções cross só na aplicação via IDs opacos.
export function createDatabaseClients(): DatabaseClients {
  if (cached) return cached;
  cached = {
    auth: new AuthPrismaClient(),
    customers: new CustomersPrismaClient(),
    products: new ProductsPrismaClient(),
    access: new AccessPrismaClient(),
    licensing: new LicensingPrismaClient(),
    billing: new BillingPrismaClient(),
    finance: new FinancePrismaClient(),
    audit: new AuditPrismaClient(),
    communications: new CommunicationsPrismaClient(),
  };
  return cached;
}

export async function disconnectDatabaseClients(): Promise<void> {
  if (!cached) return;
  await Promise.all(Object.values(cached).map((c) => c.$disconnect()));
  cached = null;
}

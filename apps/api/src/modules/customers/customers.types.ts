// Tipos espelho do prisma/customers/schema.prisma.
// O serviço usa este store em memória até a fiação do PrismaClient (DB customers).
// Não importar @prisma/client aqui: mantém o build sem clientes gerados.

export type CustomerKind = 'PF' | 'PJ';
export type CustomerStatus =
  | 'PROSPECT'
  | 'PENDING_PAYMENT'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CANCELLED';
export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type MembershipRole = 'OWNER' | 'ADMIN' | 'FINANCE' | 'MEMBER';
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
export type ConsentPurpose = 'TERMS' | 'PRIVACY' | 'MARKETING';
export type ConsentStatus = 'GRANTED' | 'WITHDRAWN';

export interface CustomerProfile {
  id: string;
  kind: CustomerKind;
  identityId: string | null;
  organizationId: string | null;
  status: CustomerStatus;
  name: string;
  email: string;
  vigenciaInicio: Date | null;
  vigenciaFim: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Organization {
  id: string;
  cnpjHash: string;
  cnpjLast4: string;
  razaoSocial: string;
  status: OrganizationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  identityId: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConsentRecord {
  id: string;
  identityId: string;
  purpose: ConsentPurpose;
  version: string;
  status: ConsentStatus;
  policyHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxRecord {
  eventId: string;
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

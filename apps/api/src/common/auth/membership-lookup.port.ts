import { Injectable } from '@nestjs/common';

/**
 * Porta de leitura de membership (customers_db `OrganizationMembership`).
 *
 * Produção (Fase 3): adaptador Prisma sobre `customersDb`
 * (`findUnique({ where: { organizationId_identityId: { organizationId, identityId } } })`),
 * exigindo `status === 'ACTIVE'`. Sem FK cross-schema: `identityId` é
 * referência opaca a `auth.UserIdentity.id` (= JWT `sub`).
 * Default-deny: `null` (sem vínculo) nunca autoriza.
 */
export const MEMBERSHIP_LOOKUP = Symbol('MEMBERSHIP_LOOKUP');

export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export interface MembershipRecord {
  organizationId: string;
  identityId: string;
  role: 'OWNER' | 'ADMIN' | 'FINANCE' | 'MEMBER';
  status: MembershipStatus;
}

export interface MembershipLookup {
  findMembership(organizationId: string, identityId: string): Promise<MembershipRecord | null>;
}

/** Implementação em memória (testes/e2e; produção usa adaptador Prisma Fase 3). */
@Injectable()
export class InMemoryMembershipLookup implements MembershipLookup {
  private readonly memberships = new Map<string, MembershipRecord>();

  private key(orgId: string, identityId: string): string {
    return `${orgId}:${identityId}`;
  }

  seed(record: MembershipRecord): void {
    this.memberships.set(this.key(record.organizationId, record.identityId), record);
  }

  clear(): void {
    this.memberships.clear();
  }

  async findMembership(organizationId: string, identityId: string): Promise<MembershipRecord | null> {
    return this.memberships.get(this.key(organizationId, identityId)) ?? null;
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeEmail } from './normalize';
import type {
  ConsentPurpose,
  ConsentRecord,
  ConsentStatus,
  CustomerProfile,
  CustomerStatus,
  MembershipRole,
  MembershipStatus,
  Organization,
  OrganizationMembership,
  OutboxRecord,
} from './customers.types';

// TODO(Fase 2 fiação): trocar este store em memória pelo PrismaClient do DB
// customers (DATABASE_URL_CUSTOMERS). Assinaturas do serviço já espelham as
// entidades do schema; a troca é interna, sem mudar o controller.

function now(): Date {
  return new Date();
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

@Injectable()
export class CustomersService {
  private readonly profiles = new Map<string, CustomerProfile>();
  private readonly orgs = new Map<string, Organization>();
  private readonly memberships = new Map<string, OrganizationMembership>();
  private readonly consents = new Map<string, ConsentRecord>();
  private readonly outbox: OutboxRecord[] = [];

  // --- invariantes ---

  // XOR PF/PJ: PF => identityId set + organizationId null;
  // PJ => identityId null + organizationId set. Espelha o CHECK da migração SQL.
  private assertProfileInvariant(p: Pick<CustomerProfile, 'kind' | 'identityId' | 'organizationId'>): void {
    const pfOk = p.kind === 'PF' && p.identityId !== null && p.organizationId === null;
    const pjOk = p.kind === 'PJ' && p.identityId === null && p.organizationId !== null;
    if (!pfOk && !pjOk) {
      throw new BadRequestException('CustomerProfile inválido: PF exige identityId (sem organizationId); PJ exige organizationId (sem identityId)');
    }
  }

  private emit(aggregate: string, aggregateId: string, type: string, payload: Record<string, unknown>): void {
    this.outbox.push({ eventId: randomUUID(), aggregate, aggregateId, type, payload, occurredAt: now() });
  }

  private activeOwners(orgId: string): OrganizationMembership[] {
    return [...this.memberships.values()].filter(
      (m) => m.organizationId === orgId && m.role === 'OWNER' && m.status === 'ACTIVE',
    );
  }

  private getMembership(orgId: string, identityId: string): OrganizationMembership | undefined {
    return [...this.memberships.values()].find(
      (m) => m.organizationId === orgId && m.identityId === identityId,
    );
  }

  private requireActiveMembership(orgId: string, identityId: string, roles?: MembershipRole[]): OrganizationMembership {
    const m = this.getMembership(orgId, identityId);
    if (!m || m.status !== 'ACTIVE') {
      throw new ForbiddenException('Sem vínculo ativo com a organização');
    }
    if (roles && !roles.includes(m.role)) {
      throw new ForbiddenException('Papel insuficiente para esta operação');
    }
    return m;
  }

  // Escopo PJ: se X-Org-Id vier no header e a rota também tiver :orgId, devem coincidir.
  resolveOrgScope(headerOrgId: string | undefined, paramOrgId?: string): string | undefined {
    if (headerOrgId && paramOrgId && headerOrgId !== paramOrgId) {
      throw new BadRequestException('X-Org-Id diverge do :orgId da rota');
    }
    return paramOrgId ?? headerOrgId;
  }

  // --- me ---

  getMe(identityId: string): CustomerProfile {
    const profile = [...this.profiles.values()].find(
      (p) => p.kind === 'PF' && p.identityId === identityId,
    );
    if (!profile) throw new NotFoundException('CustomerProfile PF não encontrado');
    return profile;
  }

  patchMe(identityId: string, input: { name?: string; email?: string }): CustomerProfile {
    let profile: CustomerProfile | undefined = [...this.profiles.values()].find(
      (p) => p.kind === 'PF' && p.identityId === identityId,
    );
    if (!profile) {
      profile = {
        id: randomUUID(),
        kind: 'PF',
        identityId,
        organizationId: null,
        status: 'PROSPECT',
        name: '',
        email: '',
        vigenciaInicio: null,
        vigenciaFim: null,
        createdAt: now(),
        updatedAt: now(),
      };
      this.assertProfileInvariant(profile);
      this.profiles.set(profile.id, profile);
      this.emit('customer', profile.id, 'customer.created.v1', { kind: 'PF', identityId });
    }
    if (input.name !== undefined) profile.name = input.name;
    if (input.email !== undefined) profile.email = normalizeEmail(input.email);
    profile.updatedAt = now();
    return profile;
  }

  // --- upgrade-to-pj ---

  upgradeToPj(callerIdentityId: string, opts: { organizationId?: string; cnpj?: string }): CustomerProfile {
    let orgId = opts.organizationId;
    if (!orgId && opts.cnpj) {
      const org = [...this.orgs.values()].find((o) => o.cnpjHash === sha256Hex(onlyDigits(opts.cnpj as string)));
      if (!org) throw new NotFoundException('Organização não encontrada para o CNPJ informado');
      orgId = org.id;
    }
    if (!orgId) throw new BadRequestException('Informe organizationId ou cnpj');
    const org = this.orgs.get(orgId);
    if (!org) throw new NotFoundException('Organização não encontrada');
    this.requireActiveMembership(orgId, callerIdentityId, ['OWNER', 'ADMIN']);

    const existing = [...this.profiles.values()].find(
      (p) => p.kind === 'PJ' && p.organizationId === orgId,
    );
    if (existing) return existing;

    const profile: CustomerProfile = {
      id: randomUUID(),
      kind: 'PJ',
      identityId: null,
      organizationId: orgId,
      status: 'PENDING_PAYMENT',
      name: org.razaoSocial,
      email: '',
      vigenciaInicio: null,
      vigenciaFim: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.assertProfileInvariant(profile);
    this.profiles.set(profile.id, profile);
    this.emit('customer', profile.id, 'customer.upgraded_to_pj.v1', { organizationId: orgId, by: callerIdentityId });
    return profile;
  }

  // --- organizations ---

  createOrganization(callerIdentityId: string, input: { razaoSocial: string; cnpj: string }): { org: Organization; membership: OrganizationMembership; profile: CustomerProfile } {
    const digits = onlyDigits(input.cnpj);
    if (digits.length !== 14) throw new BadRequestException('CNPJ inválido: 14 dígitos esperados');
    const cnpjHash = sha256Hex(digits);
    if ([...this.orgs.values()].some((o) => o.cnpjHash === cnpjHash)) {
      throw new ConflictException('CNPJ já cadastrado');
    }
    const org: Organization = {
      id: randomUUID(),
      cnpjHash,
      cnpjLast4: digits.slice(-4),
      razaoSocial: input.razaoSocial,
      status: 'ACTIVE',
      createdAt: now(),
      updatedAt: now(),
    };
    this.orgs.set(org.id, org);
    this.emit('organization', org.id, 'organization.created.v1', { cnpjLast4: org.cnpjLast4 });

    const membership: OrganizationMembership = {
      id: randomUUID(),
      organizationId: org.id,
      identityId: callerIdentityId,
      role: 'OWNER',
      status: 'ACTIVE',
      createdAt: now(),
      updatedAt: now(),
    };
    this.memberships.set(membership.id, membership);

    const profile: CustomerProfile = {
      id: randomUUID(),
      kind: 'PJ',
      identityId: null,
      organizationId: org.id,
      status: 'PENDING_PAYMENT',
      name: org.razaoSocial,
      email: '',
      vigenciaInicio: null,
      vigenciaFim: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.assertProfileInvariant(profile);
    this.profiles.set(profile.id, profile);

    return { org, membership, profile };
  }

  listOrganizations(identityId: string): Organization[] {
    const orgIds = new Set(
      [...this.memberships.values()]
        .filter((m) => m.identityId === identityId && m.status === 'ACTIVE')
        .map((m) => m.organizationId),
    );
    return [...this.orgs.values()].filter((o) => orgIds.has(o.id));
  }

  // --- members ---

  listMembers(callerIdentityId: string, orgId: string): OrganizationMembership[] {
    this.requireActiveMembership(orgId, callerIdentityId);
    return [...this.memberships.values()].filter((m) => m.organizationId === orgId);
  }

  inviteMember(
    callerIdentityId: string,
    orgId: string,
    input: { identityId: string; role?: MembershipRole },
  ): OrganizationMembership {
    this.requireActiveMembership(orgId, callerIdentityId, ['OWNER', 'ADMIN']);
    if (!this.orgs.has(orgId)) throw new NotFoundException('Organização não encontrada');
    if (this.getMembership(orgId, input.identityId)) {
      throw new ConflictException('Identidade já vinculada à organização');
    }
    const membership: OrganizationMembership = {
      id: randomUUID(),
      organizationId: orgId,
      identityId: input.identityId,
      role: input.role ?? 'MEMBER',
      status: 'INVITED',
      createdAt: now(),
      updatedAt: now(),
    };
    this.memberships.set(membership.id, membership);
    this.emit('organization_membership', membership.id, 'organization.invite_sent.v1', {
      organizationId: orgId,
      identityId: input.identityId,
      role: membership.role,
    });
    return membership;
  }

  updateMember(
    callerIdentityId: string,
    orgId: string,
    targetIdentityId: string,
    input: { role?: MembershipRole; status?: MembershipStatus },
  ): OrganizationMembership {
    this.requireActiveMembership(orgId, callerIdentityId, ['OWNER', 'ADMIN']);
    const target = this.getMembership(orgId, targetIdentityId);
    if (!target) throw new NotFoundException('Membro não encontrado');
    const leavesOwnerSeat =
      target.role === 'OWNER' &&
      target.status === 'ACTIVE' &&
      ((input.role !== undefined && input.role !== 'OWNER') ||
        (input.status !== undefined && input.status !== 'ACTIVE'));
    if (leavesOwnerSeat && this.activeOwners(orgId).length <= 1) {
      throw new ConflictException('Operação negada: último OWNER ativo da organização');
    }
    if (input.role !== undefined) target.role = input.role;
    if (input.status !== undefined) target.status = input.status;
    target.updatedAt = now();
    return target;
  }

  removeMember(callerIdentityId: string, orgId: string, targetIdentityId: string): void {
    this.requireActiveMembership(orgId, callerIdentityId, ['OWNER', 'ADMIN']);
    const target = this.getMembership(orgId, targetIdentityId);
    if (!target) throw new NotFoundException('Membro não encontrado');
    if (target.role === 'OWNER' && target.status === 'ACTIVE' && this.activeOwners(orgId).length <= 1) {
      throw new ConflictException('Operação negada: último OWNER ativo da organização');
    }
    target.status = 'REMOVED';
    target.updatedAt = now();
    this.emit('organization_membership', target.id, 'organization.member_removed.v1', {
      organizationId: orgId,
      identityId: targetIdentityId,
    });
  }

  // --- consents ---

  listConsents(identityId: string): ConsentRecord[] {
    return [...this.consents.values()]
      .filter((c) => c.identityId === identityId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  recordConsent(
    identityId: string,
    input: { purpose: ConsentPurpose; version: string; status: ConsentStatus; policyHash: string },
  ): ConsentRecord {
    const duplicate = [...this.consents.values()].find(
      (c) => c.identityId === identityId && c.purpose === input.purpose && c.version === input.version,
    );
    if (duplicate) {
      throw new ConflictException('Consentimento já registrado para identity+purpose+version');
    }
    const record: ConsentRecord = {
      id: randomUUID(),
      identityId,
      purpose: input.purpose,
      version: input.version,
      status: input.status,
      policyHash: input.policyHash,
      createdAt: now(),
      updatedAt: now(),
    };
    this.consents.set(record.id, record);
    this.emit('consent', record.id, 'consent.recorded.v1', {
      identityId,
      purpose: input.purpose,
      version: input.version,
      status: input.status,
    });
    return record;
  }

  // --- gdpr ---

  exportData(identityId: string): {
    profile: CustomerProfile | null;
    memberships: OrganizationMembership[];
    consents: ConsentRecord[];
  } {
    const profile =
      [...this.profiles.values()].find((p) => p.kind === 'PF' && p.identityId === identityId) ?? null;
    return {
      profile,
      memberships: [...this.memberships.values()].filter((m) => m.identityId === identityId),
      consents: this.listConsents(identityId),
    };
  }

  anonymize(identityId: string): CustomerProfile {
    const profile =
      [...this.profiles.values()].find((p) => p.kind === 'PF' && p.identityId === identityId) ?? null;
    if (!profile) throw new NotFoundException('CustomerProfile PF não encontrado');
    if (this.hasActiveVigencia(profile)) {
      throw new ConflictException('Anonimização negada: perfil ACTIVE com vigência em curso');
    }
    profile.name = 'ANONYMIZED';
    profile.email = `anon_${profile.id}@anonymized.local`;
    profile.status = 'CANCELLED' satisfies CustomerStatus;
    profile.vigenciaInicio = null;
    profile.vigenciaFim = null;
    profile.updatedAt = now();
    for (const m of this.memberships.values()) {
      if (m.identityId === identityId && m.status !== 'REMOVED') {
        m.status = 'REMOVED';
        m.updatedAt = now();
      }
    }
    this.emit('customer', profile.id, 'customer.anonymized.v1', { identityId });
    return profile;
  }

  private hasActiveVigencia(p: CustomerProfile): boolean {
    if (p.status !== 'ACTIVE') return false;
    if (p.vigenciaInicio === null) return false;
    return p.vigenciaFim === null || p.vigenciaFim.getTime() > Date.now();
  }

  // TODO(Fase 4): consumir evento PaymentConfirmed (billing) e ativar vigência.
  // Hook previsto (não implementar agora):
  //   async handlePaymentConfirmed(evt: {
  //     eventId: string; identityId?: string; organizationId?: string;
  //     paidAt: string; amount: number; plan: '1M' | '12M';
  //   }): Promise<void> {
  //     // 1. Idempotência: UNIQUE(eventId) — evento antigo nunca regride estado terminal.
  //     // 2. Localiza CustomerProfile (PF por identityId, PJ por organizationId).
  //     // 3. status=ACTIVE, vigenciaInicio=paidAt, vigenciaFim=paidAt+1M/12M (calendário UTC).
  //     // 4. Outbox `customer.activated.v1`.
  //   }
}

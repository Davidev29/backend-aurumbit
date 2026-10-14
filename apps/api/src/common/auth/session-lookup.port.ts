import { Injectable } from '@nestjs/common';

/**
 * Porta de leitura de sessão (auth_db).
 *
 * O schema `prisma/auth` Fase 2 contém apenas `UserIdentity` (+ Outbox);
 * o model `AuthSession` (familyId, status ACTIVE/REVOKED/EXPIRED,
 * reuse→revoga família) chega na migração da Fase 3 sem alterar regras
 * aqui: basta trocar o provider desta porta pelo adaptador Prisma
 * (`authDb.authSession.findUnique({ where: { id: sid } })`).
 * Default-deny: `null` (desconhecida) nunca autoriza.
 */
export const SESSION_LOOKUP = Symbol('SESSION_LOOKUP');

export type AuthSessionStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface SessionRecord {
  id: string;
  identityId: string;
  status: AuthSessionStatus;
  expiresAt: Date;
  revokedAt?: Date | null;
}

export interface SessionLookup {
  findById(sid: string): Promise<SessionRecord | null>;
}

/** Implementação em memória (testes/e2e; produção usa adaptador Prisma Fase 3). */
@Injectable()
export class InMemorySessionLookup implements SessionLookup {
  private readonly sessions = new Map<string, SessionRecord>();

  seed(record: SessionRecord): void {
    this.sessions.set(record.id, record);
  }

  clear(): void {
    this.sessions.clear();
  }

  async findById(sid: string): Promise<SessionRecord | null> {
    return this.sessions.get(sid) ?? null;
  }
}

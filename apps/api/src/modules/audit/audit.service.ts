import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AuditEventInput,
  StoredAuditEvent,
  sanitizeAuditMetadata,
} from './audit-record';

// Trilha append-only em memória (Fase 3 + e2e sem PG). A API propositalmente
// NÃO expõe update/delete. Fase 4: adaptador PG sobre `audit.audit_events`
// (só INSERT + SELECT), particionado, retenção 5a (LGPD.md).
@Injectable()
export class AuditService {
  private readonly events: StoredAuditEvent[] = [];

  emit(input: AuditEventInput): StoredAuditEvent {
    const ev: StoredAuditEvent = {
      id: randomUUID(),
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      metadata: sanitizeAuditMetadata(input.metadata),
      createdAt: new Date().toISOString(),
    };
    this.events.push(ev);
    return ev;
  }

  list(action?: string): StoredAuditEvent[] {
    const rows = action ? this.events.filter((e) => e.action === action) : this.events;
    return rows.map((e) => ({ ...e, metadata: { ...e.metadata } }));
  }

  listByEntity(entity: string, entityId: string): StoredAuditEvent[] {
    return this.events
      .filter((e) => e.entity === entity && e.entityId === entityId)
      .map((e) => ({ ...e, metadata: { ...e.metadata } }));
  }
}

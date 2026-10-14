import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

// Token de injeção do repositório de licenças (Fase 3: memória; Fase 4:
// adaptador PG sobre `licensing.licenses` + `license_devices` com
// `SELECT ... FOR UPDATE` no link — ver RUNBOOK).
export const LICENSE_STORE = 'LICENSE_STORE';

export type LicenseStatus = 'active' | 'suspended' | 'revoked';

export interface DeviceLink {
  deviceHash: string;
  linkedAt: string;
  lastSeenAt: string;
}

export interface LicenseRecord {
  id: string;
  ownerId: string;
  // Rótulo de exibição do titular (UI sem lookup cross-DB). Coluna PG
  // futura: `owner_label` (adaptador Fase 4) — hoje só in-memory.
  ownerLabel: string | null;
  productId: string;
  planId: string | null;
  keyHash: string;
  keyPrefix: string;
  keyLast4: string;
  keyEnc: string;
  status: LicenseStatus;
  startsAt: string;
  expiresAt: string;
  graceUntil: string;
  tokenVersion: number;
  maxDevices: number;
  devices: Map<string, DeviceLink>;
  blockedDevices: Set<string>;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseStore {
  create(rec: Omit<LicenseRecord, 'id' | 'createdAt' | 'updatedAt'>): LicenseRecord;
  get(id: string): LicenseRecord | undefined;
  getByKeyHash(keyHash: string): LicenseRecord | undefined;
  save(rec: LicenseRecord): LicenseRecord;
  /** Lista as licenças de um produto (by-product; sem dump sem filtro). */
  listByProduct(productId: string): LicenseRecord[];
}

// In-memory p/ Fase 3 + e2e sem PG. Operações são síncronas no mesmo
// processo (sem condição de corrida); o adaptador PG deverá serializar o
// link por licença (`FOR UPDATE`) para não estourar o limite sob concorrência.
@Injectable()
export class InMemoryLicenseStore implements LicenseStore {
  private readonly byId = new Map<string, LicenseRecord>();
  private readonly byHash = new Map<string, string>();

  create(rec: Omit<LicenseRecord, 'id' | 'createdAt' | 'updatedAt'>): LicenseRecord {
    if (this.byHash.has(rec.keyHash)) {
      throw new ConflictException('key_hash duplicado (retry de geração)');
    }
    const now = new Date().toISOString();
    const full: LicenseRecord = {
      ...rec,
      devices: new Map(rec.devices),
      blockedDevices: new Set(rec.blockedDevices),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(full.id, full);
    this.byHash.set(full.keyHash, full.id);
    return full;
  }

  get(id: string): LicenseRecord | undefined {
    return this.byId.get(id);
  }

  getByKeyHash(keyHash: string): LicenseRecord | undefined {
    const id = this.byHash.get(keyHash);
    return id ? this.byId.get(id) : undefined;
  }

  save(rec: LicenseRecord): LicenseRecord {
    rec.updatedAt = new Date().toISOString();
    this.byId.set(rec.id, rec);
    this.byHash.set(rec.keyHash, rec.id);
    return rec;
  }

  listByProduct(productId: string): LicenseRecord[] {
    return [...this.byId.values()]
      .filter((r) => r.productId === productId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  /** Troca o hash (rotate): remove o índice antigo. Uso interno do service. */
  reindexKeyHash(rec: LicenseRecord, oldHash: string): void {
    if (oldHash !== rec.keyHash) this.byHash.delete(oldHash);
    this.byHash.set(rec.keyHash, rec.id);
  }
}

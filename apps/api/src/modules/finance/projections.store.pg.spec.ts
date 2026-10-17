/**
 * Contrato de DDL de `finance.projection_snapshots` (finance DB).
 *
 * Regressão do HTTP 500 no GET /finance/projections: o core/store guarda
 * UM snapshot por PERÍODO (chave = scope + ref_date + premises_hash), mas
 * o 0001_baseline criou UNIQUE(scope). O `ON CONFLICT (scope, ref_date,
 * premises_hash)` do store só absorve o índice COMPOSTO — o 2º período do
 * mesmo scope (monthly 2026-11 e depois monthly 2026-12) colidia no índice
 * de `scope` → PG 23505 → não é HttpException → HTTP 500.
 *
 * O fake abaixo NÃO inventa constraint: ele deriva o catálogo de índices
 * do DDL real (diretórios de prisma/finance/migrations, na ordem em que
 * `prisma migrate deploy` aplica) e reproduz a semântica que importa:
 * - NULL nunca colide em índice único (marcador do sync x composto do core);
 * - `ON CONFLICT (cols)` só absorve conflito no índice CUJO conjunto de
 *   colunas é IGUAL ao alvo; conflito em qualquer outro unique → 23505;
 * - `ON CONFLICT (cols)` sem índice único correspondente → 42P10;
 * - NOT NULL validado antes de qualquer índice.
 * `CREATE TABLE IF NOT EXISTS` (ensure() do store) é no-op sobre um
 * catálogo já existente, como no PG — senão o DDL do adaptador
 * "apagaria" o índice do baseline e o teste passaria por engano.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_PREMISES,
  SUPPORTED_TZ,
  computeProjection,
  hashPremises,
  type ProjectionInputs,
  type ProjectionScope,
} from './projections.compute';
import { PgProjectionSnapshotStore, snapshotIdOf } from './projections.store';
import { projectionMarkerIdOf } from './sync.service';

// -- Catálogo derivado das migrations -----------------------------------------

interface UniqueIndex {
  name: string;
  cols: string[];
}

interface TableCatalog {
  exists: boolean;
  notNull: Set<string>;
  defaults: Map<string, string>;
  uniques: UniqueIndex[];
}

const TABLE = 'projection_snapshots';

const RE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?\w+"?\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/i;
const RE_PK = /CONSTRAINT\s+"?[\w]+"?\s+PRIMARY\s+KEY\s*\(([^)]+)\)/i;
const RE_UNIQUE_INDEX =
  /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s+ON\s+(?:"?\w+"?\.)?"?(\w+)"?\s*\(([^)]+)\)/i;
const RE_CREATE_INDEX = /CREATE\s+(?!UNIQUE\s)INDEX/i;
const RE_DROP_INDEX = /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))/i;
const RE_COLUMN = /^\s*"(\w+)"\s+[A-Z]/i;

function names(list: string): string[] {
  return list
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function upsertIndex(catalog: TableCatalog, index: UniqueIndex): void {
  catalog.uniques = catalog.uniques.filter((u) => u.name !== index.name);
  catalog.uniques.push(index);
}

/** Aplica um statement DDL ao catálogo (tolerante: ignora o que não é da tabela). */
function applyDdl(catalog: TableCatalog, raw: string): void {
  const sql = raw.trim().endsWith(';') ? raw : `${raw.trim()};`; // regexes exigem o `;`
  const drop = RE_DROP_INDEX.exec(sql);
  if (drop) {
    const name = drop[1] ?? drop[2];
    catalog.uniques = catalog.uniques.filter((u) => u.name !== name);
    return;
  }
  const unique = RE_UNIQUE_INDEX.exec(sql);
  if (unique) {
    if (unique[3] !== TABLE) return;
    upsertIndex(catalog, { name: unique[1] ?? unique[2], cols: names(unique[4]) });
    return;
  }
  if (RE_CREATE_INDEX.test(sql)) return; // índice não-único: só performance
  const table = RE_TABLE.exec(sql);
  if (!table || table[1] !== TABLE || catalog.exists) return; // IF NOT EXISTS: no-op
  const body = table[2];
  catalog.exists = true;
  catalog.notNull = new Set();
  catalog.defaults = new Map();
  for (const line of body.split('\n')) {
    const col = RE_COLUMN.exec(line);
    if (!col) continue;
    if (line.toUpperCase().includes('NOT NULL')) catalog.notNull.add(col[1]);
    const def = /DEFAULT\s+(.+?)\s*,?\s*$/i.exec(line);
    if (def) catalog.defaults.set(col[1], def[1]);
  }
  const pk = RE_PK.exec(body);
  if (pk) upsertIndex(catalog, { name: `${TABLE}_pkey`, cols: names(pk[1]) });
}

/** Statements separados por `;` (migration = 1 arquivo com N comandos). */
function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Catálogo = 0001_baseline + migrations aditivas, na ordem do migrate deploy. */
function catalogFromMigrations(): TableCatalog {
  const dir = resolve(__dirname, '../../../../../prisma/finance/migrations');
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => join(dir, name, 'migration.sql'));
  const catalog: TableCatalog = { exists: false, notNull: new Set(), defaults: new Map(), uniques: [] };
  for (const f of files) for (const stmt of splitStatements(readFileSync(f, 'utf8'))) applyDdl(catalog, stmt);
  return catalog;
}

/** Constraints únicos declarados no model ProjectionSnapshot (campo → coluna). */
function uniquesFromSchema(): string[][] {
  const file = resolve(__dirname, '../../../../../prisma/finance/schema.prisma');
  const model = /model\s+ProjectionSnapshot\s*\{([\s\S]*?)\n\}/.exec(readFileSync(file, 'utf8'));
  if (!model) throw new Error('model ProjectionSnapshot não encontrado em schema.prisma');
  const columnOf = new Map<string, string>();
  for (const line of model[1].split('\n')) {
    const field = /^\s*(\w+)\s+String\??\b/.exec(line);
    if (field) columnOf.set(field[1], /@map\("([^"]+)"\)/.exec(line)?.[1] ?? field[1]);
  }
  const declared: string[][] = [];
  for (const line of model[1].split('\n')) {
    if (/^\s*\w+\s+String\??\b.*@id\b/.test(line) && columnOf.size > 0) {
      const field = /^\s*(\w+)/.exec(line)?.[1] as string;
      declared.push([columnOf.get(field) ?? field]); // PK entra como unique de 1 coluna
    } else if (/^\s*\w+\s+String\??\b.*(?<!\S)@unique(?!\S)/.test(line)) {
      const field = /^\s*(\w+)/.exec(line)?.[1] as string;
      declared.push([columnOf.get(field) ?? field]);
    }
    const multi = /@@unique\(\[([^\]]+)\]\)/.exec(line);
    if (multi) {
      declared.push(
        names(multi[1]).map((f) => {
          const col = columnOf.get(f);
          if (!col) throw new Error(`campo ${f} do @@unique não encontrado no model`);
          return col;
        }),
      );
    }
  }
  return declared;
}

// -- Fake Postgres (só o que o contrato precisa) -----------------------------

class PgError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PgError';
  }
}

type Row = Record<string, unknown>;

const RE_INSERT =
  /INSERT\s+INTO\s+"?\w+"?\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:ON\s+CONFLICT|RETURNING|$)/i;
const RE_ON_CONFLICT = /ON\s+CONFLICT\s*\(([^)]*)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]*?)(?:\s+RETURNING|\s*$)/i;
const RE_SELECT = /SELECT\s+([\s\S]*?)\s+FROM\s+"?\w+"?\s+WHERE\s+([\s\S]*?)(?:\s*$)/i;
const RE_DELETE = /DELETE\s+FROM\s+"?\w+"?\s+WHERE\s+([\s\S]*?)(?:\s*$)/i;
const RE_SET_ITEM = /"?(\w+)"?\s*=\s*(.+?)(?=,|$)/g;

function literal(token: string, params: unknown[]): unknown {
  const t = token.trim();
  const ref = /^\$(\d+)$/.exec(t);
  if (ref) return params[Number(ref[1]) - 1];
  if (/^now\(\)$/i.test(t) || /CURRENT_TIMESTAMP/i.test(t)) return new Date().toISOString();
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^null$/i.test(t)) return null;
  return t.replace(/^'|'$/g, '');
}

/** Avalia `col <op> $n`; NULL propaga (SQL de 3 valores → não casa). */
function whereMatches(row: Row, where: string, params: unknown[]): boolean {
  for (const raw of where.split(/\s+AND\s+/i)) {
    const m = /^\s*"?(\w+)"?\s*(=|<|>)\s*(.+?)\s*$/.exec(raw);
    if (!m) throw new Error(`WHERE não mapeado no fake: ${raw}`);
    const left = row[m[1]];
    const right = literal(m[3], params);
    if (left === null || left === undefined || right === null || right === undefined) return false;
    const l = left as string | number;
    const r = right as string | number;
    if (!(m[2] === '=' ? l === r : m[2] === '<' ? l < r : l > r)) return false;
  }
  return true;
}

/** Índice único que colide (NULL nunca colide, como no PG). */
function conflicting(catalog: TableCatalog, rows: Row[], candidate: Row): { index: UniqueIndex; row: Row } | null {
  for (const index of catalog.uniques) {
    if (index.cols.some((c) => candidate[c] === null || candidate[c] === undefined)) continue;
    const hit = rows.find((r) => index.cols.every((c) => r[c] === candidate[c]));
    if (hit) return { index, row: hit };
  }
  return null;
}

class FakeProjectionTable {
  readonly sql: string[] = [];
  rows: Row[] = [];

  constructor(readonly catalog: TableCatalog) {}

  async query(sql: string, params: unknown[] = []): Promise<{ rowCount: number; rows: Row[] }> {
    this.sql.push(sql);
    // ensure() do store manda 3 statements num query só.
    let last: { rowCount: number; rows: Row[] } = { rowCount: 0, rows: [] };
    for (const stmt of sql.includes(';') ? splitStatements(sql) : [sql]) last = this.exec(stmt, params);
    return last;
  }

  private exec(sql: string, params: unknown[]): { rowCount: number; rows: Row[] } {
    const ddl = `${sql.trim()};`; // o ; do fim é obrigatório nos regexes de DDL
    if (RE_TABLE.test(ddl) || RE_UNIQUE_INDEX.test(ddl) || RE_DROP_INDEX.test(ddl) || RE_CREATE_INDEX.test(ddl)) {
      applyDdl(this.catalog, ddl);
      return { rowCount: 0, rows: [] };
    }
    if (RE_INSERT.test(sql)) return this.insert(RE_INSERT.exec(sql) as RegExpExecArray, params, sql);
    if (RE_SELECT.test(sql)) return this.select(RE_SELECT.exec(sql) as RegExpExecArray, params);
    if (RE_DELETE.test(sql)) return this.del(RE_DELETE.exec(sql) as RegExpExecArray, params);
    throw new Error(`SQL não mapeado no fake: ${sql.slice(0, 90)}`);
  }

  private insert(m: RegExpExecArray, params: unknown[], raw: string): { rowCount: number; rows: Row[] } {
    const cols = names(m[1]);
    const values = m[2].split(',');
    const candidate: Row = {};
    cols.forEach((c, i) => {
      candidate[c] = literal(values[i] ?? 'NULL', params);
    });
    // DEFAULT do DDL para coluna ausente (ex.: `valid` e `createdAt`).
    for (const [col, def] of this.catalog.defaults) {
      if (!(col in candidate)) candidate[col] = literal(def, params);
    }
    for (const c of this.catalog.notNull) {
      if (candidate[c] === null || candidate[c] === undefined) {
        throw new PgError('23502', `null value in column "${c}" violates not-null constraint`);
      }
    }
    const onConflict = RE_ON_CONFLICT.exec(raw);
    let arbiter: UniqueIndex | undefined;
    if (onConflict) {
      const target = names(onConflict[1]);
      arbiter = this.catalog.uniques.find((u) => u.cols.join() === target.join());
      if (!arbiter) {
        throw new PgError('42P10', `there is no unique or exclusion constraint matching ON CONFLICT (${target})`);
      }
    }
    const hasNullKey = !arbiter || arbiter.cols.some((c) => candidate[c] === null);
    const hit: Row | undefined = hasNullKey
      ? undefined
      : this.rows.find((r) => (arbiter as UniqueIndex).cols.every((c) => r[c] === candidate[c]));

    if (hit) {
      // DO UPDATE: o PG só reinsere índices cujas colunas mudaram, logo
      // violar OUTRO unique só é erro se a outra linha for diferente.
      for (const index of this.catalog.uniques) {
        if (index === arbiter || index.cols.some((c) => candidate[c] === null)) continue;
        const other = this.rows.find((r) => r !== hit && index.cols.every((c) => r[c] === candidate[c]));
        if (other) throw new PgError('23505', `duplicate key value violates unique constraint "${index.name}"`);
      }
      for (const [, col, expr] of (onConflict as RegExpExecArray)[2].matchAll(RE_SET_ITEM)) {
        const excluded = /^EXCLUDED\.(\w+)$/i.exec(expr.trim());
        hit[col] = excluded ? candidate[excluded[1]] : literal(expr, params);
      }
      return { rowCount: 1, rows: [hit] };
    }

    // INSERT normal (sem match no arbiter): qualquer unique violado é erro —
    // é aqui que o UNIQUE(scope) do 0001_baseline matava o 2º período.
    const clash = conflicting(this.catalog, this.rows, candidate);
    if (clash) {
      throw new PgError('23505', `duplicate key value violates unique constraint "${clash.index.name}"`);
    }
    this.rows.push(candidate);
    return { rowCount: 1, rows: [candidate] };
  }

  private select(m: RegExpExecArray, params: unknown[]): { rowCount: number; rows: Row[] } {
    const projection = m[1].split(',').map((p) => p.trim());
    const rows = this.rows.filter((r) => whereMatches(r, m[2], params)).map((r) => {
      const out: Row = {};
      for (const p of projection) {
        const alias = /\s+AS\s+"?(\w+)"?/i.exec(p);
        const col = /^"?(\w+)"?/.exec(p);
        if (col) out[alias ? alias[1] : col[1]] = r[col[1]];
      }
      return out;
    });
    return { rowCount: rows.length, rows };
  }

  private del(m: RegExpExecArray, params: unknown[]): { rowCount: number; rows: Row[] } {
    const keep = this.rows.filter((r) => !whereMatches(r, m[1], params));
    const rowCount = this.rows.length - keep.length;
    this.rows = keep;
    return { rowCount, rows: [] };
  }
}

let mockPool: FakeProjectionTable;
jest.mock('pg', () => ({ Pool: jest.fn(() => mockPool) }));

// -- Fixtures ----------------------------------------------------------------

const EMPTY_INPUTS: ProjectionInputs = {
  receivables: [],
  payables: [],
  subscriptions: [],
  transactions: [],
};

const MARKER_SQL =
  `INSERT INTO projection_snapshots (id, scope, valid, "computedAt", "invalidatedAt", "createdAt", "updatedAt")` +
  ` VALUES ($1,$2,false,NULL,now(),now(),now())` +
  ` ON CONFLICT (id) DO UPDATE SET valid = false, "invalidatedAt" = now(), "updatedAt" = now()` +
  ` RETURNING id`;

function snapshot(scope: ProjectionScope, refDate: string) {
  return computeProjection({ scope, refDate, tz: SUPPORTED_TZ, inputs: EMPTY_INPUTS });
}

function storeOn(catalog: TableCatalog): { store: PgProjectionSnapshotStore; fake: FakeProjectionTable } {
  const fake = new FakeProjectionTable(catalog);
  mockPool = fake;
  return { store: new PgProjectionSnapshotStore(), fake };
}

const keysOf = (catalog: TableCatalog) => catalog.uniques.map((u) => u.cols.join(' + ')).sort();

describe('projection_snapshots — contrato de DDL (migrations finance)', () => {
  it('scope NÃO é unique no banco: 2 períodos do mesmo scope coexistem (regressão do 500/23505)', async () => {
    const catalog = catalogFromMigrations();
    expect(catalog.exists).toBe(true);
    expect(catalog.uniques.map((u) => u.cols)).not.toContainEqual(['scope']);
    expect(catalog.uniques.map((u) => u.cols)).toContainEqual(['scope', 'ref_date', 'premises_hash']);

    const { store, fake } = storeOn(catalog);
    const premisesHash = hashPremises(DEFAULT_PREMISES);
    const nov = snapshot('monthly', '2026-11-15');
    const dez = snapshot('monthly', '2026-12-15');

    await store.upsert(nov); // 1ª leitura (o 500 original só aparecia na 2ª)
    await expect(store.upsert(dez)).resolves.toBeDefined(); // mesmo scope, refDate ≠

    expect(fake.rows).toHaveLength(2);
    expect((await store.find('monthly', '2026-11-15', premisesHash))?.refDate).toBe('2026-11-15');
    expect((await store.find('monthly', '2026-12-15', premisesHash))?.refDate).toBe('2026-12-15');
    // `id` determinístico → linhas distintas do mesmo scope.
    expect(fake.rows.map((r) => r.id)).toEqual([
      snapshotIdOf('monthly', '2026-11-15', premisesHash),
      snapshotIdOf('monthly', '2026-12-15', premisesHash),
    ]);
  });

  it('3 scopes do mesmo refDate coexistem; re-upsert da mesma chave atualiza (idempotente)', async () => {
    const { store, fake } = storeOn(catalogFromMigrations());
    const refDate = '2026-11-15';
    for (const scope of ['monthly', 'quarterly', 'annual'] as const) {
      await store.upsert(snapshot(scope, refDate));
    }
    expect(fake.rows).toHaveLength(3);

    const again = snapshot('monthly', refDate);
    again.totals.previstoReceita = 4242;
    await store.upsert(again);
    expect(fake.rows).toHaveLength(3); // mesma chave → DO UPDATE, não duplica
    const monthly = fake.rows.find((r) => r.scope === 'monthly') as Row;
    const payload = JSON.parse(monthly.payload as string) as { totals: { previstoReceita: number } };
    expect(payload.totals.previstoReceita).toBe(4242);
  });

  it('marcador do sync: 1 linha por namespace, arbitrado pela PK id', async () => {
    const fake = new FakeProjectionTable(catalogFromMigrations());
    mockPool = fake;
    const global = projectionMarkerIdOf('global');

    await fake.query(MARKER_SQL, [global, 'global']);
    await fake.query(MARKER_SQL, [global, 'global']); // outro evento do mesmo namespace
    await fake.query(MARKER_SQL, [projectionMarkerIdOf('org:abc'), 'org:abc']);

    expect(fake.rows).toHaveLength(2);
    expect(fake.rows.map((r) => r.scope).sort()).toEqual(['global', 'org:abc']);
    expect(global).not.toBe(projectionMarkerIdOf('org:abc'));
    // `ON CONFLICT (scope)` morreu com o índice: agora dá 42P10 (não 23505).
    await expect(
      fake.query(MARKER_SQL.replace('ON CONFLICT (id)', 'ON CONFLICT (scope)'), ['id-avulso', 'global']),
    ).rejects.toMatchObject({ code: '42P10' });
    // Marcador não tem período → NULL não colide com o composto do core.
    expect(fake.rows.every((r) => r.ref_date === undefined || r.ref_date === null)).toBe(true);
  });

  it('invalidateRange apaga só o período sobreposto (2 períodos do mesmo scope)', async () => {
    const { store, fake } = storeOn(catalogFromMigrations());
    const nov = snapshot('monthly', '2026-11-15');
    const dez = snapshot('monthly', '2026-12-15');
    await store.upsert(nov);
    await store.upsert(dez);

    await expect(store.invalidateRange(nov.period.start, nov.period.end)).resolves.toBe(1);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].ref_date).toBe('2026-12-15');
  });

  it('schema.prisma e as migrations declaram os MESMOS unique (anti-drift do migrate-diff-check)', () => {
    const catalog = catalogFromMigrations();
    expect(keysOf(catalog)).toEqual(uniquesFromSchema().map((c) => c.join(' + ')).sort());
    // Guard de arquivo: 0001_baseline criou o índice; a migration 20261017000000
    // é quem o remove. Se a nova for apagada/revertida, este teste acusa.
    expect(catalog.uniques.map((u) => u.name)).not.toContain('projection_snapshots_scope_key');
  });
});
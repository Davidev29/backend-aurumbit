#!/usr/bin/env node
/**
 * sync-platform-catalog.mjs — gerador do catálogo de plataformas (T1 do
 * CORRECTION-PLAN-02).
 *
 * FONTE ÚNICA (o único lugar onde o catálogo é escrito à mão):
 *   libs/contracts/src/products.catalog.json
 *
 * ARTEFATOS DERIVADOS (gerados aqui — NUNCA editar à mão):
 *   libs/contracts/src/products.catalog.generated.ts            (contrato)
 *   apps/api/src/modules/products/platform-catalog.generated.ts (borda fail-closed)
 *   apps/admin/lib/platforms.generated.ts                       (admin)
 *   apps/portal/lib/platforms.generated.ts                      (portal/landpage)
 * Consumidor direto da fonte (não passa por artefato):
 *   tools/build-tag-icons.py  → lê o JSON (ids/labels/assetFile/monochrome)
 *
 * Uso:
 *   node tools/sync-platform-catalog.mjs          # gera/atualiza
 *   node tools/sync-platform-catalog.mjs --check  # NÃO escreve; reprova se houver drift
 *
 * O QUE O `--check` REPROVA (gate do CI via `pnpm catalog:check`):
 *   1. artefato ausente ou diferente do que o JSON produz (diff linha a linha);
 *   2. PNG de plataforma faltando em `ASSETS/tags/` (fonte) ou em
 *      `apps/{admin,portal}/public/tags/` (servidos pelos fronts) — inclui a
 *      variante `-dark` das monocromáticas;
 *   3. PNG ÓRFÃO em `apps/{admin,portal}/public/tags/` (ícone que saiu do
 *      catálogo ou nome fora do padrão) — drift que sobraria para sempre sem
 *      este check.
 *
 * Por que existe: o catálogo estava escrito em 5 lugares (contracts, dto da
 * API, admin, portal, script Python) e a divergência era silenciosa — só
 * aparecia como "id que a API recusa" (400) ou "ícone que não carrega". Agora
 * existe UM lugar e um gate.
 *
 * Compatibilidade: o JSON válido produz byte-a-byte os mesmos valores dos
 * tipos de hoje (`PRODUCT_PLATFORM_IDS`, `PLATFORM_LABELS`, `DELIVERY_MODES`,
 * `monochrome=apple`) — nenhum slug, rótulo ou ícone mudou.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REL = 'libs/contracts/src/products.catalog.json';
const SOURCE = join(ROOT, SOURCE_REL);

const KNOWN_ARGS = new Set(['--check']);
for (const arg of process.argv.slice(2)) {
  if (!KNOWN_ARGS.has(arg)) {
    console.error(`sync-platform-catalog: argumento desconhecido: ${arg}`);
    console.error('uso: node tools/sync-platform-catalog.mjs [--check]');
    process.exit(2);
  }
}
const CHECK = process.argv.includes('--check');

/** Erro de configuração (JSON inválido, id duplicado...): aborta com exit 2. */
function fatal(message) {
  console.error(`sync-platform-catalog: ${message}`);
  process.exit(2);
}

/** Trecho estável usado por todos os testes de mesa. */
const BANNER = [
  '/* GERADO POR tools/sync-platform-catalog.mjs — NÃO EDITAR À MÃO.',
  ' *',
  ` * Fonte única: ${SOURCE_REL}`,
  ' * Depois de editar a fonte rode `pnpm catalog:sync`; o CI cobra com `pnpm catalog:check`.',
  ' */',
].join('\n');

const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const MODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;
const ALLOWED_KEYS = new Set(['$comment', 'platforms', 'deliveryModes']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value, where) {
  if (typeof value !== 'string' || value.trim() === '') {
    fatal(`${where} deve ser um texto não vazio (recebido: ${JSON.stringify(value)})`);
  }
  return value;
}

/**
 * Lê e VALIDA a fonte. Validação aqui (e não só no gate) porque o artefato
 * gerado é TypeScript compilado: um id com espaço geraria um tipo que quebra
 * o build do app inteiro, e o erro apareceria longe da causa.
 */
function loadCatalog() {
  if (!existsSync(SOURCE)) fatal(`fonte não encontrada: ${SOURCE_REL}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(SOURCE, 'utf8'));
  } catch (e) {
    fatal(`${SOURCE_REL} não é JSON válido: ${e.message}`);
  }
  if (!isPlainObject(raw)) fatal(`${SOURCE_REL} deve ser um objeto JSON`);

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      fatal(`${SOURCE_REL}: chave desconhecida "${key}" (válidas: ${[...ALLOWED_KEYS].join(', ')})`);
    }
  }

  if (!Array.isArray(raw.platforms) || raw.platforms.length === 0) {
    fatal(`${SOURCE_REL}: "platforms" deve ser um array com pelo menos 1 item`);
  }
  const platforms = [];
  const seen = new Set();
  raw.platforms.forEach((item, index) => {
    const where = `platforms[${index}]`;
    if (!isPlainObject(item)) fatal(`${SOURCE_REL}: ${where} deve ser um objeto`);
    const id = requireString(item.id, `${where}.id`);
    if (!ID_PATTERN.test(id)) {
      fatal(`${SOURCE_REL}: ${where}.id "${id}" inválido — use slug minúsculo (ex.: "windows")`);
    }
    if (seen.has(id)) fatal(`${SOURCE_REL}: id duplicado "${id}"`);
    seen.add(id);
    const label = requireString(item.label, `${where}.label`);
    const shortLabel = requireString(item.shortLabel, `${where}.shortLabel`);
    const assetFile = requireString(item.assetFile, `${where}.assetFile`);
    if (typeof item.monochrome !== 'boolean') {
      fatal(`${SOURCE_REL}: ${where}.monochrome deve ser true/false`);
    }
    const extra = Object.keys(item).filter(
      (k) => !['id', 'label', 'shortLabel', 'monochrome', 'assetFile'].includes(k),
    );
    if (extra.length > 0) {
      fatal(`${SOURCE_REL}: ${where} tem chave desconhecida: ${extra.join(', ')}`);
    }
    platforms.push({ id, label, shortLabel, monochrome: item.monochrome, assetFile });
  });

  if (!Array.isArray(raw.deliveryModes) || raw.deliveryModes.length === 0) {
    fatal(`${SOURCE_REL}: "deliveryModes" deve ser um array com pelo menos 1 item`);
  }
  const modes = [];
  raw.deliveryModes.forEach((value, index) => {
    if (typeof value !== 'string' || !MODE_PATTERN.test(value)) {
      fatal(
        `${SOURCE_REL}: deliveryModes[${index}] "${value}" inválido — use MAIÚSCULAS com _ (ex.: "OFFLINE")`,
      );
    }
    if (modes.includes(value)) fatal(`${SOURCE_REL}: deliveryMode duplicado "${value}"`);
    modes.push(value);
  });

  return { platforms, deliveryModes: modes };
}

const str = (value) => JSON.stringify(value);
const arr = (values) => `[${values.map(str).join(', ')}]`;
const union = (values) => values.map(str).join(' | ');

/** `Record<K, T>` multilinha, na ordem da fonte (diffs pequenos). Chave sempre citada. */
function literalRecord(entries) {
  return ['{', ...entries.map(([key, value]) => `  ${str(key)}: ${str(value)},`), '}'].join('\n');
}

function buildContracts(catalog) {
  const ids = catalog.platforms.map((p) => p.id);
  const monochrome = catalog.platforms.filter((p) => p.monochrome).map((p) => p.id);
  return `${BANNER}

export const CATALOG_PLATFORM_IDS = ${arr(ids)} as const;
export type CatalogPlatformId = (typeof CATALOG_PLATFORM_IDS)[number];

/** Rótulo pt-BR completo (UI do admin/landpage e mensagens de erro da API). */
export const CATALOG_PLATFORM_LABELS: Record<CatalogPlatformId, string> = ${literalRecord(
    catalog.platforms.map((p) => [p.id, p.label]),
  )};

/** Rótulo curto (cards estreitos da vitrine, onde o completo não cabe). */
export const CATALOG_PLATFORM_SHORT_LABELS: Record<CatalogPlatformId, string> = ${literalRecord(
    catalog.platforms.map((p) => [p.id, p.shortLabel]),
  )};

/**
 * Marcas monocromáticas (uma cor só): invisíveis no tema dark — os fronts
 * carregam a variante \`<id>-dark.png\` só para estas.
 */
export const CATALOG_MONOCHROME_PLATFORMS = ${arr(monochrome)} as const satisfies readonly CatalogPlatformId[];

export const CATALOG_DELIVERY_MODES = ${arr(catalog.deliveryModes)} as const;
export type CatalogDeliveryMode = (typeof CATALOG_DELIVERY_MODES)[number];
`;
}

function buildApi(catalog) {
  const ids = catalog.platforms.map((p) => p.id);
  return `${BANNER}

export const PRODUCT_PLATFORM_IDS = ${arr(ids)} as const;
export type ProductPlatformId = (typeof PRODUCT_PLATFORM_IDS)[number];

/** OFFLINE = só no dispositivo (legado). HYBRID = offline + sincroniza. */
export const PRODUCT_DELIVERY_MODES = ${arr(catalog.deliveryModes)} as const;
export type ProductDeliveryMode = (typeof PRODUCT_DELIVERY_MODES)[number];
`;
}

function buildAdmin(catalog) {
  const ids = catalog.platforms.map((p) => p.id);
  const options = catalog.platforms.map((p) => {
    const src = `src: "/tags/${p.id}.png"`;
    const dark = p.monochrome ? `, darkSrc: "/tags/${p.id}-dark.png"` : '';
    return `  { id: ${str(p.id)}, label: ${str(p.label)}, ${src}${dark} },`;
  });
  return `${BANNER}

export type ProductPlatformId = ${union(ids)};

/** Canônico, na ordem do backend. \`readonly\` p/ a UI nunca reordenar por acaso. */
export const PRODUCT_PLATFORM_IDS = ${arr(ids)} as const satisfies readonly ProductPlatformId[];

export interface PlatformOption {
  /** Id estável — vai para \`products.platforms\`. */
  id: ProductPlatformId;
  /** Rótulo pt-BR exibido (fonte única: products.catalog.json). */
  label: string;
  /** PNG p/ tema light (\`/public/tags/<id>.png\`). */
  src: string;
  /** Variante p/ tema dark — só as marcas monocromáticas têm. */
  darkSrc?: string;
}

export const PRODUCT_PLATFORMS: readonly PlatformOption[] = [
${options.join('\n')}
];

export type ProductDeliveryMode = ${union(catalog.deliveryModes)};

export const PRODUCT_DELIVERY_MODES = ${arr(
    catalog.deliveryModes,
  )} as const satisfies readonly ProductDeliveryMode[];
`;
}

function buildPortal(catalog) {
  const ids = catalog.platforms.map((p) => p.id);
  const monochrome = catalog.platforms.filter((p) => p.monochrome);
  const darkVariant =
    monochrome.length === 0 ? '{}' : literalRecord(monochrome.map((p) => [p.id, true]));
  return `${BANNER}

/** Slugs estáveis — vão para \`products.platforms TEXT[]\`. Renomear = migration. */
export const PLATFORM_IDS = ${arr(ids)} as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

/** Modo de entrega — espelha \`products.delivery_mode\`. Default do banco: \`OFFLINE\`. */
export const DELIVERY_MODES = ${arr(catalog.deliveryModes)} as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** Rótulos pt-BR da UI (admin + landpage). */
export const PLATFORM_LABELS: Record<PlatformId, string> = ${literalRecord(
    catalog.platforms.map((p) => [p.id, p.label]),
  )};

/** Versão curta p/ onde o rótulo completo não cabe (card da vitrine). */
export const PLATFORM_SHORT_LABELS: Record<PlatformId, string> = ${literalRecord(
    catalog.platforms.map((p) => [p.id, p.shortLabel]),
  )};

/**
 * Só a marca Apple é monocromática (preta) — \`build-tag-icons.py\` gera a
 * variante invertida \`-dark\`. As outras têm cor própria e funcionam nos dois
 * temas sobre \`--bg-2\`.
 */
export const DARK_VARIANT: Partial<Record<PlatformId, true>> = ${darkVariant};
`;
}

const ARTIFACTS = [
  { file: 'libs/contracts/src/products.catalog.generated.ts', build: buildContracts },
  { file: 'apps/api/src/modules/products/platform-catalog.generated.ts', build: buildApi },
  { file: 'apps/admin/lib/platforms.generated.ts', build: buildAdmin },
  { file: 'apps/portal/lib/platforms.generated.ts', build: buildPortal },
];

const normalizeEol = (text) => text.replaceAll('\r\n', '\n');

/** Primeiras divergências linha a linha (ação direta no log do CI). */
function describeDrift(expected, actual, limit = 8) {
  const a = normalizeEol(expected).split('\n');
  const b = normalizeEol(actual).split('\n');
  const lines = [];
  const total = Math.max(a.length, b.length);
  for (let i = 0; i < total && lines.length < limit; i += 1) {
    if (a[i] !== b[i]) {
      lines.push(`  linha ${i + 1}:`);
      lines.push(`    esperado: ${a[i] === undefined ? '<fim do arquivo>' : a[i]}`);
      lines.push(`    no disco: ${b[i] === undefined ? '<fim do arquivo>' : b[i]}`);
    }
  }
  if (total > limit) lines.push(`  (mostrando até ${limit} divergências)`);
  return lines.join('\n');
}

/**
 * Assets: cada plataforma precisa do PNG de origem e dos PNGs servidos pelos
 * fronts (variante `-dark` quando monocromática). Órfão também reprova.
 */
function checkAssets(catalog) {
  const problems = [];
  const monochrome = new Set(catalog.platforms.filter((p) => p.monochrome).map((p) => p.id));

  for (const platform of catalog.platforms) {
    const asset = join(ROOT, 'ASSETS/tags', platform.assetFile);
    if (!existsSync(asset)) {
      problems.push(
        `ASSETS/tags/${platform.assetFile} não existe (plataforma "${platform.id}") — adicione a arte na fonte`,
      );
    }
  }

  for (const app of ['admin', 'portal']) {
    const dir = join(ROOT, `apps/${app}/public/tags`);
    const expected = new Set(
      catalog.platforms.flatMap((p) => (monochrome.has(p.id) ? [`${p.id}.png`, `${p.id}-dark.png`] : [`${p.id}.png`])),
    );
    const found = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.png')) : [];
    for (const name of expected) {
      if (!found.includes(name)) {
        problems.push(`apps/${app}/public/tags/${name} faltando — rode: python tools/build-tag-icons.py`);
      }
    }
    for (const name of found) {
      if (!expected.has(name)) {
        problems.push(
          `apps/${app}/public/tags/${name} é ÓRFÃO (plataforma fora do catálogo ou nome fora do padrão)`,
        );
      }
    }
  }

  return problems;
}

const catalog = loadCatalog();
const counts = `${catalog.platforms.length} plataformas, ${catalog.deliveryModes.length} modos`;
const assetProblems = checkAssets(catalog);

if (CHECK) {
  const problems = [];
  for (const artifact of ARTIFACTS) {
    const path = join(ROOT, artifact.file);
    const expected = artifact.build(catalog);
    if (!existsSync(path)) {
      problems.push(`DRIFT: ${artifact.file} não existe (rode: pnpm catalog:sync)`);
      continue;
    }
    const actual = readFileSync(path, 'utf8');
    if (normalizeEol(actual) !== normalizeEol(expected)) {
      problems.push(`DRIFT: ${artifact.file}\n${describeDrift(expected, actual)}`);
    }
  }
  problems.push(...assetProblems.map((p) => `ASSET: ${p}`));

  if (problems.length > 0) {
    console.error('catalog:check REPROVADO (fonte: libs/contracts/src/products.catalog.json):');
    for (const problem of problems) console.error(`- ${problem}`);
    console.error('corrija com: pnpm catalog:sync (e python tools/build-tag-icons.py p/ ícones)');
    process.exit(1);
  }
  console.log(`catalog:check OK — ${counts}, ${ARTIFACTS.length} artefatos, ícones dos 2 fronts completos.`);
  process.exit(0);
}

let written = 0;
for (const artifact of ARTIFACTS) {
  const path = join(ROOT, artifact.file);
  const content = artifact.build(catalog);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current !== null && normalizeEol(current) === normalizeEol(content)) {
    console.log(`catalog:sync mantém ${artifact.file}`);
    continue;
  }
  writeFileSync(path, content);
  written += 1;
  console.log(`catalog:sync escreveu ${artifact.file}`);
}

if (assetProblems.length > 0) {
  console.error('catalog:sync: catálogo gerado, mas os assets estão incompletos:');
  for (const problem of assetProblems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`catalog:sync OK — ${counts}, ${written} artefato(s) escrito(s), ícones dos 2 fronts completos.`);

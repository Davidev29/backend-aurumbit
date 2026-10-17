/**
 * Plataformas do produto + modo de entrega — artefato GERADO + lógica de exibição.
 *
 * FONTE ÚNICA: `libs/contracts/src/products.catalog.json` — o mesmo dado que a
 * API valida na borda e que o `tools/build-tag-icons.py` usa p/ gerar os PNGs
 * em `apps/portal/public/tags/<id>.png`. Este módulo reexporta
 * `./platforms.generated` (produzido por `tools/sync-platform-catalog.mjs`;
 * rode `pnpm catalog:sync`) e mantém só a lógica de UI. NUNCA edite ids/labels
 * aqui: o CI reprova drift com `pnpm catalog:check` — que também pega ícone
 * órfão em `public/tags`.
 *
 * POR QUE UM GERADO E NÃO O IMPORT DO PACOTE: `apps/portal` não declara
 * dependência de workspace (`apps/portal/package.json` não lista
 * `@aurum-bit/contracts` e `apps/portal/node_modules/@aurum-bit` não existe),
 * então o import direto é impossível hoje. Quando o portal linkar o pacote,
 * troque o import por `@aurum-bit/contracts` e apague o gerado (mesmo caminho
 * de `apps/api/modules/products/dto.ts`).
 *
 * VALIDAÇÃO FAIL-SOFT: o backend já é fail-closed (`PLATFORM_ID_SCHEMA`), mas
 * aqui a entrada pode ser cache velho, API desatualizada ou stub — então
 * `platforms` ausente/vazio/não-array ou com slug desconhecido é DESCARTADO em
 * silêncio. `[]` significa "nenhuma plataforma declarada", NUNCA "todas as
 * plataformas" (essa é a mentira que a landpage contava antes).
 *
 * ÍCONES: PNGs locais em `apps/portal/public/tags/<id>.png`, servidos por
 * `next/image` (path local não entra na allowlist `images.remotePatterns`).
 * OVERRIDE REGISTRADO DO USUÁRIO ao DS v1 §4 ("sem assets Apple"): vale só
 * para estas marcas de plataforma. Todo o resto do DS continua lei —
 * `lucide-react` para o resto da UI, `aria-hidden`/rótulo pt-BR, alvos de
 * 44px em interativo, cores 100% via `var(--*)`, zero emoji.
 */
import {
  DARK_VARIANT,
  DELIVERY_MODES,
  PLATFORM_IDS,
  PLATFORM_LABELS,
  PLATFORM_SHORT_LABELS,
  type DeliveryMode,
  type PlatformId,
} from "./platforms.generated";

export { DELIVERY_MODES, PLATFORM_IDS, PLATFORM_LABELS, PLATFORM_SHORT_LABELS };
export type { DeliveryMode, PlatformId };

const PLATFORM_ID_SET = new Set<string>(PLATFORM_IDS);

/**
 * Normaliza `platforms` vindo de API/mock/cache.
 *
 * Entrada inválida → `[]`. Slug fora do catálogo → descartado (sem throw, sem
 * log: o front não pode quebrar por um id novo do backend).
 * A ordem de saída é a CANÔNICA (não a do `TEXT[]`) para a vitrine não
 * reordenar quando o refetch devolve os mesmos itens em outra ordem.
 */
export function normalizePlatforms(raw: unknown): PlatformId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim().toLowerCase();
    if (PLATFORM_ID_SET.has(id)) seen.add(id);
  }
  return PLATFORM_IDS.filter((id) => seen.has(id));
}

/**
 * Normaliza `deliveryMode`. Ausente/desconhecido → `OFFLINE` (default do banco).
 * ATENÇÃO: `OFFLINE` aqui é FALLBACK DE EXIBIÇÃO (campo ausente em cache velho
 * ou stub), não uma afirmação sobre o produto — o valor real vem de
 * `products.delivery_mode`.
 */
export function normalizeDeliveryMode(raw: unknown): DeliveryMode {
  if (typeof raw !== "string") return "OFFLINE";
  const value = raw.trim().toUpperCase();
  return (DELIVERY_MODES as readonly string[]).includes(value)
    ? (value as DeliveryMode)
    : "OFFLINE";
}

/** Caminho do PNG de plataforma no `public/` (local — não é URL remota). */
export function platformIconSrc(id: PlatformId, dark: boolean): string {
  return dark && DARK_VARIANT[id] ? `/tags/${id}-dark.png` : `/tags/${id}.png`;
}

/** Rótulo pt-BR completo da plataforma. */
export function platformLabel(id: PlatformId): string {
  return PLATFORM_LABELS[id] ?? id;
}

/** Linha curta de contexto (card da vitrine). */
export function deliveryModeLabel(mode: DeliveryMode): string {
  return mode === "HYBRID" ? "Offline + servidor" : "100% offline";
}

/** Tile de especificação (modal): valor em destaque + legenda. */
export const DELIVERY_MODE_TILE: Record<DeliveryMode, { value: string; label: string }> = {
  OFFLINE: { value: "100%", label: "offline" },
  HYBRID: { value: "Offline", label: "+ sincronização" },
};

/** Frase da confiança no rodapé do modal, coerente com o modo de entrega. */
export function deliveryModeReassurance(mode: DeliveryMode): string {
  return mode === "HYBRID"
    ? "funciona offline e sincroniza com o servidor quando a internet volta"
    : "funciona offline por natureza";
}

/**
 * Nomes de sistema operacional para `schema.org/SoftwareApplication.operatingSystem`.
 * Mapa separado de propósito: `apple` é "iOS" aqui, não o rótulo de UI
 * "Apple (iOS/iPadOS)" — o campo é lido por máquina.
 */
const OPERATING_SYSTEM_NAMES: Record<PlatformId, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  web: "Web",
  apple: "iOS",
};

/**
 * `operatingSystem` do JSON-LD. `[]`/ausente → `undefined`, e o caller OMITE
 * o campo. Nunca devolve "todas" nem um valor fixo.
 */
export function operatingSystemsFrom(raw: unknown): string | undefined {
  const list = normalizePlatforms(raw);
  if (list.length === 0) return undefined;
  return list.map((id) => OPERATING_SYSTEM_NAMES[id]).join(", ");
}

/** Junta rótulos em prosa pt-BR: "Windows" · "Windows e macOS" · "a, b e c". */
export function joinPtBr(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

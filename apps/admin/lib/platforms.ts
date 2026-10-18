/**
 * Catálogo canônico de plataformas de produto + helpers de UI.
 *
 * FONTE ÚNICA: `libs/contracts/src/products.catalog.json` — o pacote
 * `@aurum-bit/contracts` (dependência `workspace:*`) expõe os literais tipados
 * que a API usa na validação fail-closed e que o `tools/build-tag-icons.py` usa
 * p/ gerar os PNGs em `public/tags/`. NUNCA edite ids/labels aqui: o CI reprova
 * drift e ícone órfão com `pnpm catalog:check`.
 *
 * A ordem do array é a ordem CANÔNICA: o backend reordena por ela, então
 * enviar nesta ordem torna a resposta da API idêntica ao que a UI mostra.
 * Os ids vão para o banco (`products.platforms TEXT[] NOT NULL DEFAULT '{}'`)
 * — NÃO renomear sem migration.
 */
import {
  DELIVERY_MODES,
  MONOCHROME_PLATFORMS,
  PLATFORM_IDS,
  PLATFORM_LABELS,
} from "@aurum-bit/contracts";

export type ProductPlatformId = (typeof PLATFORM_IDS)[number];

/** Canônico, na ordem do backend. `readonly` p/ a UI nunca reordenar por acaso. */
export const PRODUCT_PLATFORM_IDS = PLATFORM_IDS;

export interface PlatformOption {
  /** Id estável — vai para `products.platforms`. */
  id: ProductPlatformId;
  /** Rótulo pt-BR exibido (fonte única: products.catalog.json). */
  label: string;
  /** PNG p/ tema light (`/public/tags/<id>.png`). */
  src: string;
  /** Variante p/ tema dark — só as marcas monocromáticas têm. */
  darkSrc?: string;
}

const MONOCHROME_ID_SET = new Set<string>(MONOCHROME_PLATFORMS);

export const PRODUCT_PLATFORMS: readonly PlatformOption[] = PLATFORM_IDS.map((id) => ({
  id,
  label: PLATFORM_LABELS[id],
  src: `/tags/${id}.png`,
  ...(MONOCHROME_ID_SET.has(id) ? { darkSrc: `/tags/${id}-dark.png` } : {}),
}));

export type ProductDeliveryMode = (typeof DELIVERY_MODES)[number];
export const PRODUCT_DELIVERY_MODES = DELIVERY_MODES;

/**
 * Ordem canônica (dedup + trim). O backend também normaliza — isto deixa a
 * prévia da UI idêntica ao que será gravado.
 */
export function normalizePlatformIds(ids: readonly string[]): ProductPlatformId[] {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if ((PRODUCT_PLATFORM_IDS as readonly string[]).includes(id)) seen.add(id);
  }
  return PRODUCT_PLATFORM_IDS.filter((id) => seen.has(id));
}

/**
 * Label legível p/ id desconhecido (legado gravado antes do catálogo, ou
 * payload vindo de outra fonte). Nunca lança: devolve o próprio id.
 */
export function platformLabel(id: string): string {
  return PRODUCT_PLATFORMS.find((p) => p.id === id)?.label ?? id;
}

export interface DeliveryModeOption {
  value: ProductDeliveryMode;
  label: string;
  hint: string;
}

/**
 * Rótulos pedidos explicitamente pelo usuário ("offline completo" x "híbrido").
 *
 * Exaustivo POR TIPO (`Record<ProductDeliveryMode, ...>`): um modo novo no
 * catálogo quebra o build aqui até ganhar texto — nunca some da UI em
 * silêncio.
 */
const DELIVERY_MODE_COPY: Record<ProductDeliveryMode, { label: string; hint: string }> = {
  OFFLINE: {
    label: "Offline completo",
    hint: "A licença roda só no dispositivo, sem internet.",
  },
  HYBRID: {
    label: "Híbrido (online + offline)",
    hint: "Roda offline e sincroniza quando há internet.",
  },
};

/** Options do seletor, na ordem canônica do catálogo. */
export const DELIVERY_MODE_OPTIONS: readonly DeliveryModeOption[] = PRODUCT_DELIVERY_MODES.map(
  (value) => ({ value, ...DELIVERY_MODE_COPY[value] }),
);

export function deliveryModeLabel(mode: string): string {
  return DELIVERY_MODE_OPTIONS.find((d) => d.value === mode)?.label ?? mode;
}

/* GERADO POR tools/sync-platform-catalog.mjs — NÃO EDITAR À MÃO.
 *
 * Fonte única: libs/contracts/src/products.catalog.json
 * Depois de editar a fonte rode `pnpm catalog:sync`; o CI cobra com `pnpm catalog:check`.
 */

export const CATALOG_PLATFORM_IDS = ["windows", "macos", "linux", "web", "apple"] as const;
export type CatalogPlatformId = (typeof CATALOG_PLATFORM_IDS)[number];

/** Rótulo pt-BR completo (UI do admin/landpage e mensagens de erro da API). */
export const CATALOG_PLATFORM_LABELS: Record<CatalogPlatformId, string> = {
  "windows": "Windows",
  "macos": "macOS",
  "linux": "Linux",
  "web": "Web",
  "apple": "Apple (iOS/iPadOS)",
};

/** Rótulo curto (cards estreitos da vitrine, onde o completo não cabe). */
export const CATALOG_PLATFORM_SHORT_LABELS: Record<CatalogPlatformId, string> = {
  "windows": "Windows",
  "macos": "macOS",
  "linux": "Linux",
  "web": "Web",
  "apple": "Apple",
};

/**
 * Marcas monocromáticas (uma cor só): invisíveis no tema dark — os fronts
 * carregam a variante `<id>-dark.png` só para estas.
 */
export const CATALOG_MONOCHROME_PLATFORMS = ["apple"] as const satisfies readonly CatalogPlatformId[];

export const CATALOG_DELIVERY_MODES = ["OFFLINE", "HYBRID"] as const;
export type CatalogDeliveryMode = (typeof CATALOG_DELIVERY_MODES)[number];

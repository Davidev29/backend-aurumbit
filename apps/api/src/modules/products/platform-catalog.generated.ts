/* GERADO POR tools/sync-platform-catalog.mjs — NÃO EDITAR À MÃO.
 *
 * Fonte única: libs/contracts/src/products.catalog.json
 * Depois de editar a fonte rode `pnpm catalog:sync`; o CI cobra com `pnpm catalog:check`.
 */

export const PRODUCT_PLATFORM_IDS = ["windows", "macos", "linux", "web", "apple"] as const;
export type ProductPlatformId = (typeof PRODUCT_PLATFORM_IDS)[number];

/** OFFLINE = só no dispositivo (legado). HYBRID = offline + sincroniza. */
export const PRODUCT_DELIVERY_MODES = ["OFFLINE", "HYBRID"] as const;
export type ProductDeliveryMode = (typeof PRODUCT_DELIVERY_MODES)[number];

/* GERADO POR tools/sync-platform-catalog.mjs — NÃO EDITAR À MÃO.
 *
 * Fonte única: libs/contracts/src/products.catalog.json
 * Depois de editar a fonte rode `pnpm catalog:sync`; o CI cobra com `pnpm catalog:check`.
 */

/** Slugs estáveis — vão para `products.platforms TEXT[]`. Renomear = migration. */
export const PLATFORM_IDS = ["windows", "macos", "linux", "web", "apple"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

/** Modo de entrega — espelha `products.delivery_mode`. Default do banco: `OFFLINE`. */
export const DELIVERY_MODES = ["OFFLINE", "HYBRID"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** Rótulos pt-BR da UI (admin + landpage). */
export const PLATFORM_LABELS: Record<PlatformId, string> = {
  "windows": "Windows",
  "macos": "macOS",
  "linux": "Linux",
  "web": "Web",
  "apple": "Apple (iOS/iPadOS)",
};

/** Versão curta p/ onde o rótulo completo não cabe (card da vitrine). */
export const PLATFORM_SHORT_LABELS: Record<PlatformId, string> = {
  "windows": "Windows",
  "macos": "macOS",
  "linux": "Linux",
  "web": "Web",
  "apple": "Apple",
};

/**
 * Só a marca Apple é monocromática (preta) — `build-tag-icons.py` gera a
 * variante invertida `-dark`. As outras têm cor própria e funcionam nos dois
 * temas sobre `--bg-2`.
 */
export const DARK_VARIANT: Partial<Record<PlatformId, true>> = {
  "apple": true,
};

/* GERADO POR tools/sync-platform-catalog.mjs — NÃO EDITAR À MÃO.
 *
 * Fonte única: libs/contracts/src/products.catalog.json
 * Depois de editar a fonte rode `pnpm catalog:sync`; o CI cobra com `pnpm catalog:check`.
 */

export type ProductPlatformId = "windows" | "macos" | "linux" | "web" | "apple";

/** Canônico, na ordem do backend. `readonly` p/ a UI nunca reordenar por acaso. */
export const PRODUCT_PLATFORM_IDS = ["windows", "macos", "linux", "web", "apple"] as const satisfies readonly ProductPlatformId[];

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

export const PRODUCT_PLATFORMS: readonly PlatformOption[] = [
  { id: "windows", label: "Windows", src: "/tags/windows.png" },
  { id: "macos", label: "macOS", src: "/tags/macos.png" },
  { id: "linux", label: "Linux", src: "/tags/linux.png" },
  { id: "web", label: "Web", src: "/tags/web.png" },
  { id: "apple", label: "Apple (iOS/iPadOS)", src: "/tags/apple.png", darkSrc: "/tags/apple-dark.png" },
];

export type ProductDeliveryMode = "OFFLINE" | "HYBRID";

export const PRODUCT_DELIVERY_MODES = ["OFFLINE", "HYBRID"] as const satisfies readonly ProductDeliveryMode[];

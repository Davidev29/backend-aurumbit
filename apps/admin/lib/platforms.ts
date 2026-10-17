/**
 * Catálogo canônico de plataformas de produto — CÓPIA DEFENSIVA.
 *
 * Fonte da verdade (todas precisam concordar; mudar aqui é mudar contrato):
 *  - `apps/api/src/modules/products/dto.ts` → `PRODUCT_PLATFORM_IDS`
 *    (validação fail-closed no `ValidationPipe` global).
 *  - `tools/build-tag-icons.py` → `PLATFORMS` (gera os PNGs em
 *    `public/tags/`, com os rótulos pt-BR).
 *  - `prisma/.../products` → coluna `products.platforms TEXT[] NOT NULL
 *    DEFAULT '{}'` + `delivery_mode TEXT NOT NULL DEFAULT 'OFFLINE'`.
 *
 * A ordem do array é a ordem CANÔNICA: o backend reordena por ela, então
 * enviar nesta ordem torna a resposta da API idêntica ao que a UI mostra.
 * Os ids vão para o banco — NÃO renomear sem migration.
 *
 * O rótulo vem do script (`label`), que é o que o usuário lê no admin e na
 * landpage.
 */

export type ProductPlatformId = "windows" | "macos" | "linux" | "web" | "apple";

/** Canônico, na ordem do backend. `readonly` p/ a UI nunca reordenar por acaso. */
export const PRODUCT_PLATFORM_IDS = [
  "windows",
  "macos",
  "linux",
  "web",
  "apple",
] as const satisfies readonly ProductPlatformId[];

export interface PlatformOption {
  /** Id estável — vai para `products.platforms`. */
  id: ProductPlatformId;
  /** Rótulo pt-BR exibido (`tools/build-tag-icons.py` → `label`). */
  label: string;
  /** PNG p/ tema light (`/public/tags/<id>.png`). */
  src: string;
  /**
   * Variante p/ tema dark, quando existe.
   *
   * Só a marca Apple é monocromática preta (`MONOCHROME = {"apple"}` no
   * script): em `--bg-0: #0b0d10` ela sumiria. As outras 4 têm cor própria.
   */
  darkSrc?: string;
}

export const PRODUCT_PLATFORMS: readonly PlatformOption[] = [
  { id: "windows", label: "Windows", src: "/tags/windows.png" },
  { id: "macos", label: "macOS", src: "/tags/macos.png" },
  { id: "linux", label: "Linux", src: "/tags/linux.png" },
  { id: "web", label: "Web", src: "/tags/web.png" },
  { id: "apple", label: "Apple (iOS/iPadOS)", src: "/tags/apple.png", darkSrc: "/tags/apple-dark.png" },
];

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

/** `OFFLINE` = só no dispositivo (legado). `HYBRID` = offline + sincroniza. */
export type ProductDeliveryMode = "OFFLINE" | "HYBRID";

export const PRODUCT_DELIVERY_MODES = ["OFFLINE", "HYBRID"] as const satisfies readonly ProductDeliveryMode[];

export interface DeliveryModeOption {
  value: ProductDeliveryMode;
  label: string;
  hint: string;
}

/** Rótulos pedidos explicitamente pelo usuário ("offline completo" x "híbrido"). */
export const DELIVERY_MODE_OPTIONS: readonly DeliveryModeOption[] = [
  {
    value: "OFFLINE",
    label: "Offline completo",
    hint: "A licença roda só no dispositivo, sem internet.",
  },
  {
    value: "HYBRID",
    label: "Híbrido (online + offline)",
    hint: "Roda offline e sincroniza quando há internet.",
  },
];

export function deliveryModeLabel(mode: string): string {
  return DELIVERY_MODE_OPTIONS.find((d) => d.value === mode)?.label ?? mode;
}

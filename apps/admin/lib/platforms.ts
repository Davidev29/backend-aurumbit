/**
 * Catálogo canônico de plataformas de produto — artefato GERADO + helpers de UI.
 *
 * FONTE ÚNICA: `libs/contracts/src/products.catalog.json` — o mesmo dado que a
 * API usa na validação fail-closed da borda (`ValidationPipe`) e que o
 * `tools/build-tag-icons.py` usa p/ gerar os PNGs em `public/tags/`.
 * NUNCA edite ids/labels aqui: rode `pnpm catalog:sync` (`tools/sync-platform-catalog.mjs`)
 * e o CI confere com `pnpm catalog:check` — que também reprova ícone órfão em
 * `public/tags` (plataforma que saiu do catálogo não fica servida para sempre).
 *
 * A ordem do array é a ordem CANÔNICA: o backend reordena por ela, então
 * enviar nesta ordem torna a resposta da API idêntica ao que a UI mostra.
 * Os ids vão para o banco (`products.platforms TEXT[] NOT NULL DEFAULT '{}'`)
 * — NÃO renomear sem migration.
 */
import {
  PRODUCT_DELIVERY_MODES,
  PRODUCT_PLATFORM_IDS,
  PRODUCT_PLATFORMS,
  type PlatformOption,
  type ProductDeliveryMode,
  type ProductPlatformId,
} from "./platforms.generated";

export { PRODUCT_DELIVERY_MODES, PRODUCT_PLATFORM_IDS, PRODUCT_PLATFORMS };
export type { PlatformOption, ProductDeliveryMode, ProductPlatformId };

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

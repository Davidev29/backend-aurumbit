/**
 * Invariantes da FONTE ÚNICA do catálogo (`products.catalog.json`) e do
 * artefato gerado do contrato.
 *
 * O que este teste NÃO cobre de propósito: os gerados dos apps (`admin`,
 * `portal`, `apps/api`) e os PNGs de `public/tags` — quem cobre é
 * `pnpm catalog:check` (`tools/sync-platform-catalog.mjs --check`), que roda no
 * job de lint do CI (o turbo não vê arquivo fora do pacote no hash do cache,
 * então o gate do gate é o script, não o teste).
 */
import { describe, expect, it } from "vitest";
import catalog from "./products.catalog.json";
import {
  CATALOG_DELIVERY_MODES,
  CATALOG_MONOCHROME_PLATFORMS,
  CATALOG_PLATFORM_IDS,
  CATALOG_PLATFORM_LABELS,
  CATALOG_PLATFORM_SHORT_LABELS,
} from "./products.catalog.generated";
import { DELIVERY_MODES, PLATFORM_IDS, PLATFORM_LABELS, PLATFORM_SHORT_LABELS } from "./products";

const platforms = catalog.platforms;

describe("catálogo de plataformas (fonte única)", () => {
  it("ids são slugs únicos (vão para products.platforms — renomear exige migration)", () => {
    const ids = platforms.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual([...new Set(ids)]);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("rótulos e arquivo de arte nunca vêm vazios", () => {
    for (const platform of platforms) {
      expect(platform.label.trim()).not.toBe("");
      expect(platform.shortLabel.trim()).not.toBe("");
      expect(platform.assetFile.trim()).not.toBe("");
      expect(typeof platform.monochrome).toBe("boolean");
    }
  });

  it("assetFile aponta para imagem que o build-tag-icons.py consegue abrir", () => {
    for (const platform of platforms) {
      // A EXISTÊNCIA do arquivo em ASSETS/tags é checada por `pnpm catalog:check`
      // (que também pega órfão em public/tags) — aqui só a forma do nome.
      expect(platform.assetFile, platform.id).toMatch(/\.(png|jpe?g|jfif|webp)$/i);
    }
  });

  it("o artefato gerado do contrato bate com o JSON (drift = rode `pnpm catalog:sync`)", () => {
    expect([...CATALOG_PLATFORM_IDS]).toEqual(platforms.map((p) => p.id));
    expect(CATALOG_PLATFORM_LABELS).toEqual(
      Object.fromEntries(platforms.map((p) => [p.id, p.label])),
    );
    expect(CATALOG_PLATFORM_SHORT_LABELS).toEqual(
      Object.fromEntries(platforms.map((p) => [p.id, p.shortLabel])),
    );
    expect([...CATALOG_MONOCHROME_PLATFORMS]).toEqual(
      platforms.filter((p) => p.monochrome).map((p) => p.id),
    );
    expect([...CATALOG_DELIVERY_MODES]).toEqual(catalog.deliveryModes);
  });

  it("`products.ts` reexporta o artefato (ninguém reintroduziu lista à mão)", () => {
    expect(PLATFORM_IDS).toEqual(CATALOG_PLATFORM_IDS);
    expect(PLATFORM_LABELS).toEqual(CATALOG_PLATFORM_LABELS);
    expect(PLATFORM_SHORT_LABELS).toEqual(CATALOG_PLATFORM_SHORT_LABELS);
    expect(DELIVERY_MODES).toEqual(CATALOG_DELIVERY_MODES);
  });
});

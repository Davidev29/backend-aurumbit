import { describe, expect, it } from "vitest";
import {
  DELIVERY_MODE_OPTIONS,
  PRODUCT_PLATFORMS,
  deliveryModeLabel,
  normalizePlatformIds,
  platformLabel,
} from "./platforms";

// Contratos do admin (T5-2 do CORRECTION-PLAN-02). O admin grava
// `products.platforms` — a prévia da UI PRECISA ser idêntica ao que o backend
// vai persistir. Estes testes travam: descarte de desconhecido, dedup/ordem
// canônica e os fallbacks que nunca lançam (id legado no banco).
describe("normalizePlatformIds (prévia = o que o backend grava)", () => {
  it("descarta id desconhecido em silêncio", () => {
    expect(normalizePlatformIds(["android", "windows"])).toEqual(["windows"]);
  });

  it("só desconhecidos → [] (nunca 'todas')", () => {
    expect(normalizePlatformIds(["android"])).toEqual([]);
    expect(normalizePlatformIds([])).toEqual([]);
  });

  it("dedup + trim, saída na ordem canônica", () => {
    expect(normalizePlatformIds([" apple ", "windows", "apple"])).toEqual(["windows", "apple"]);
  });
});

describe("platformLabel (nunca lança)", () => {
  it("id do catálogo → rótulo completo", () => {
    expect(platformLabel("apple")).toBe("Apple (iOS/iPadOS)");
  });

  it("id desconhecido (legado gravado antes do catálogo) → devolve o próprio id", () => {
    expect(platformLabel("amigaos")).toBe("amigaos");
  });
});

describe("modo de entrega", () => {
  it("deliveryModeLabel: conhecidos e fallback inofensivo", () => {
    expect(deliveryModeLabel("OFFLINE")).toBe("Offline completo");
    expect(deliveryModeLabel("HYBRID")).toBe("Híbrido (online + offline)");
    expect(deliveryModeLabel("qualquer")).toBe("qualquer");
  });

  it("DELIVERY_MODE_OPTIONS cobre o catálogo, na ordem canônica", () => {
    expect(DELIVERY_MODE_OPTIONS.map((o) => o.value)).toEqual(["OFFLINE", "HYBRID"]);
  });
});

describe("PRODUCT_PLATFORMS (ícones)", () => {
  it("todo id tem src local; só a monocromática tem darkSrc", () => {
    for (const p of PRODUCT_PLATFORMS) {
      expect(p.src).toBe(`/tags/${p.id}.png`);
      if (p.id === "apple") expect(p.darkSrc).toBe("/tags/apple-dark.png");
      else expect(p.darkSrc).toBeUndefined();
    }
  });
});

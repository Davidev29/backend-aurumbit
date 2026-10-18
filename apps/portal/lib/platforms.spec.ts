import { describe, expect, it } from "vitest";
import {
  deliveryModeLabel,
  deliveryModeReassurance,
  joinPtBr,
  normalizeDeliveryMode,
  normalizePlatforms,
  operatingSystemsFrom,
  platformIconSrc,
  platformLabel,
} from "./platforms";

// Contratos de exibição da vitrine (T5-2 do CORRECTION-PLAN-02). Estes testes
// travam a semântica FAIL-SOFT em dois pontos que já foram bug real:
// (1) entrada podre (cache velho/stub/API atrasada) NUNCA vira plataforma na
// tela; (2) `[]` significa "nenhuma declarada" — NUNCA "todas".
// Se alguém "consertar" a normalização aceitando slug desconhecido, isto quebra.
describe("normalizePlatforms (fail-soft)", () => {
  it("descarta slug desconhecido em silêncio", () => {
    expect(normalizePlatforms(["android", "windows"])).toEqual(["windows"]);
  });

  it("entrada não-array → []", () => {
    expect(normalizePlatforms(undefined)).toEqual([]);
    expect(normalizePlatforms(null)).toEqual([]);
    expect(normalizePlatforms("windows")).toEqual([]);
    expect(normalizePlatforms(42)).toEqual([]);
  });

  it("só desconhecidos → [] (nunca 'todas')", () => {
    expect(normalizePlatforms(["android", "ios"])).toEqual([]);
  });

  it("dedup + trim + case-insensitive", () => {
    expect(normalizePlatforms([" WINDOWS ", "windows", "Windows"])).toEqual(["windows"]);
  });

  it("saída na ordem CANÔNICA, não na de entrada", () => {
    expect(normalizePlatforms(["apple", "web", "windows"])).toEqual(["windows", "web", "apple"]);
  });
});

describe("normalizeDeliveryMode", () => {
  it("desconhecido/ausente → OFFLINE (default do banco)", () => {
    expect(normalizeDeliveryMode("banana")).toBe("OFFLINE");
    expect(normalizeDeliveryMode(undefined)).toBe("OFFLINE");
    expect(normalizeDeliveryMode(null)).toBe("OFFLINE");
  });

  it("aceita case-insensitive com trim", () => {
    expect(normalizeDeliveryMode(" hybrid ")).toBe("HYBRID");
    expect(normalizeDeliveryMode("offline")).toBe("OFFLINE");
  });
});

describe("operatingSystemsFrom (JSON-LD)", () => {
  it("vazio/ausente/só-desconhecido → undefined (caller omite o campo)", () => {
    expect(operatingSystemsFrom([])).toBeUndefined();
    expect(operatingSystemsFrom(undefined)).toBeUndefined();
    expect(operatingSystemsFrom(["android"])).toBeUndefined();
  });

  it("apple vira 'iOS' (campo lido por máquina, não rótulo de UI)", () => {
    expect(operatingSystemsFrom(["apple"])).toBe("iOS");
  });

  it("junta na ordem canônica", () => {
    expect(operatingSystemsFrom(["macos", "windows"])).toBe("Windows, macOS");
  });
});

describe("rótulos, ícones e prosa", () => {
  it("platformLabel devolve o rótulo completo do catálogo", () => {
    expect(platformLabel("windows")).toBe("Windows");
    expect(platformLabel("apple")).toBe("Apple (iOS/iPadOS)");
  });

  it("deliveryModeLabel cobre os dois modos", () => {
    expect(deliveryModeLabel("HYBRID")).toBe("Offline + servidor");
    expect(deliveryModeLabel("OFFLINE")).toBe("100% offline");
  });

  it("deliveryModeReassurance coerente com o modo", () => {
    expect(deliveryModeReassurance("HYBRID")).toContain("sincroniza");
    expect(deliveryModeReassurance("OFFLINE")).toContain("offline por natureza");
  });

  it("platformIconSrc: variante -dark só para marca monocromática", () => {
    expect(platformIconSrc("apple", true)).toBe("/tags/apple-dark.png");
    expect(platformIconSrc("windows", true)).toBe("/tags/windows.png");
    expect(platformIconSrc("apple", false)).toBe("/tags/apple.png");
  });

  it("joinPtBr: 0, 1, 2 e 3 itens", () => {
    expect(joinPtBr([])).toBe("");
    expect(joinPtBr(["Windows"])).toBe("Windows");
    expect(joinPtBr(["Windows", "macOS"])).toBe("Windows e macOS");
    expect(joinPtBr(["Windows", "macOS", "Linux"])).toBe("Windows, macOS e Linux");
  });
});

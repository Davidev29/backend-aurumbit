/**
 * Mocks do Portal — catálogo público + área do cliente.
 * Espelham Nest `/v1/products`, `/v1/auth/*`, `/v1/licenses`, `/v1/billing/*`.
 * BFF usa estes stubs quando `API_INTERNAL_URL` não está configurado.
 * TODO(backend pronto): remover e buscar via upstream real.
 *
 * `platforms`/`deliveryMode` abaixo são STUB (alarme A-MOCK-001): existem só
 * para a primeira pintura SSR da landpage não ficar incoerente (o
 * `requestIdleCallback` de `ProductsSection` troca pelo dado real 2,5s depois).
 * Não são fonte da verdade — a verdade é `products.platforms` /
 * `products.delivery_mode` no banco. Se apagarmos este arquivo, estes blocos
 * vão junto e a UI cai no estado honesto ("não informado").
 */
import type {
  ProductView,
  CustomerLicenseView,
  CustomerInvoiceView,
  CustomerSubscriptionView,
  CustomerProfileData,
  MeResponse,
  Page,
} from "@/types";

export const MOCK_CATALOG: ProductView[] = [
  {
    id: "prd-aurum-pro",
    code: "aurum-pro",
    name: "Aurum Pro",
    slug: "aurum-pro",
    description:
      "O completo para lojas e escritórios com até 3 computadores e atendimento mais rápido.\n\nFunciona offline por natureza — a internet só valida a licença. Atualiza sozinho quando ela volta. Chave liberada após a confirmação do pagamento, com passo a passo simples de instalação. Pagamento seguro com Pix, boleto ou cartão.",
    shortDescription: "O completo para até 3 computadores, com atendimento mais rápido",
    status: "ACTIVE",
    machinesAllowed: 3,
    plans: [
      {
        id: "plan-aurum-pro-month",
        productId: "prd-aurum-pro",
        name: "Aurum Pro Mensal",
        billingInterval: "MONTH",
        priceCents: 14990,
        currency: "BRL",
        status: "ATIVO",
        validFrom: "2026-09-01T12:00:00.000Z",
        validTo: null,
        supersededBy: null,
        features: [
          { featureCode: "Funciona offline, sem depender da internet" },
          { featureCode: "3 computadores por chave" },
          { featureCode: "Chave liberada após a confirmação do pagamento" },
          { featureCode: "Atendimento prioritário em português" },
        ],
      },
      {
        id: "plan-aurum-pro-year",
        productId: "prd-aurum-pro",
        name: "Aurum Pro Anual",
        billingInterval: "YEAR",
        priceCents: 119900,
        currency: "BRL",
        status: "ATIVO",
        validFrom: "2026-09-01T12:00:00.000Z",
        validTo: null,
        supersededBy: null,
        features: [
          { featureCode: "Funciona offline, sem depender da internet" },
          { featureCode: "3 computadores por chave" },
          { featureCode: "Chave liberada após a confirmação do pagamento" },
          { featureCode: "Atendimento prioritário em português" },
          { featureCode: "Preço menor no plano anual" },
        ],
      },
    ],
    gallery: [],
    category: "Profissional",
    tags: ["funciona-sem-internet", "3-computadores", "atendimento-prioritario"],
    // STUB (A-MOCK-001) — slugs de `PLATFORM_IDS`; a verdade é o banco.
    platforms: ["windows", "macos", "linux"],
    deliveryMode: "OFFLINE",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "prd-aurum-base",
    code: "aurum-base",
    name: "Aurum Base",
    slug: "aurum-base",
    description:
      "O essencial para quem tem 1 computador e quer resolver o básico bem feito.\n\nFunciona offline por natureza — a internet só valida a licença. Atualiza sozinho quando ela volta. Chave liberada após a confirmação do pagamento, com passo a passo simples de instalação. Ajuda em português por e-mail.",
    shortDescription: "O essencial para quem tem 1 computador",
    status: "ACTIVE",
    machinesAllowed: 1,
    plans: [
      {
        id: "plan-aurum-base-onetime",
        productId: "prd-aurum-base",
        name: "Aurum Base Vitalício",
        billingInterval: "ONE_TIME",
        priceCents: 349900,
        currency: "BRL",
        status: "ATIVO",
        validFrom: "2026-10-14T12:00:00.000Z",
        validTo: null,
        supersededBy: null,
        features: [
          { featureCode: "Funciona offline, sem depender da internet", channel: "DESKTOP" },
          { featureCode: "1 computador por chave", channel: "DESKTOP" },
          { featureCode: "Chave liberada após a confirmação do pagamento" },
          { featureCode: "Compra única, sua para sempre", channel: "DESKTOP" },
        ],
      },
      {
        id: "plan-aurum-base-year",
        productId: "prd-aurum-base",
        name: "Aurum Base Anual",
        billingInterval: "YEAR",
        priceCents: 119900,
        currency: "BRL",
        status: "ATIVO",
        validFrom: "2026-09-15T12:00:00.000Z",
        validTo: null,
        supersededBy: null,
        features: [
          { featureCode: "Funciona offline, sem depender da internet" },
          { featureCode: "1 computador por chave" },
          { featureCode: "Chave liberada após a confirmação do pagamento" },
          { featureCode: "Ajuda em português por e-mail", channel: "WEB" },
        ],
      },
    ],
    gallery: [],
    category: "Essencial",
    tags: ["funciona-sem-internet", "1-computador", "ajuda-em-portugues"],
    // STUB (A-MOCK-001) — slugs de `PLATFORM_IDS`; a verdade é o banco.
    platforms: ["windows", "macos", "web"],
    deliveryMode: "OFFLINE",
    createdAt: "2026-09-15T12:00:00.000Z",
    updatedAt: "2026-09-15T12:00:00.000Z",
  },
  {
    id: "prd-aurum-enterprise",
    code: "aurum-enterprise",
    name: "Aurum Enterprise",
    slug: "aurum-enterprise",
    description:
      "Para empresas com muitos computadores, que precisam de controle e de alguém para chamar pelo nome.\n\nFunciona offline por natureza — a internet só valida a licença. Atualiza sozinho quando ela volta. Instalado dentro da sua empresa, nos seus computadores, com entrada única para a equipe e registro do que cada pessoa fez no sistema.",
    shortDescription: "Para operações grandes, com controle e gerente dedicado",
    status: "ACTIVE",
    machinesAllowed: 50,
    plans: [
      {
        id: "plan-aurum-enterprise-year",
        productId: "prd-aurum-enterprise",
        name: "Aurum Enterprise Anual",
        billingInterval: "YEAR",
        priceCents: 499900,
        currency: "BRL",
        status: "ATIVO",
        validFrom: "2026-10-01T12:00:00.000Z",
        validTo: null,
        supersededBy: null,
        features: [
          { featureCode: "Funciona offline, sem depender da internet" },
          { featureCode: "50 computadores ou mais por chave" },
          { featureCode: "Instalado dentro da sua empresa" },
          { featureCode: "Entrada única para a equipe" },
          { featureCode: "Registro do que cada pessoa fez no sistema" },
          { featureCode: "Gerente dedicado" },
        ],
      },
    ],
    gallery: [],
    category: "Enterprise",
    tags: ["funciona-offline", "50-computadores", "gerente-dedicado"],
    // STUB (A-MOCK-001) — slugs de `PLATFORM_IDS`; a verdade é o banco.
    platforms: ["windows", "macos", "linux", "web"],
    // Única linha HYBRID do stub, de propósito: a entrada "funciona offline e
    // sincroniza com o servidor" precisa existir para o caminho de UI
    // (`Offline · + sincronização`) ser exercitado na landpage.
    deliveryMode: "HYBRID",
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
  },
];

export function mockCatalogPage(q: string, category?: string | null): Page<ProductView> {
  const needle = (q ?? "").toLowerCase();
  const filtered = MOCK_CATALOG.filter(
    (p) =>
      (!needle || p.name.toLowerCase().includes(needle)) &&
      (!category || category === "all" || p.category === category)
  );
  return { data: filtered, meta: { nextCursor: null, limit: 20 } };
}

export function mockProductByCode(code: string): ProductView | null {
  return MOCK_CATALOG.find((p) => p.code === code) ?? null;
}

/* ---------------- Área do cliente ---------------- */

export const MOCK_ME_CUSTOMER: MeResponse = {
  id: "u-customer-1",
  email: "cliente@aurum.test",
  name: "Carlos Cliente",
  displayName: "Carlos",
  mfaRequired: false,
  mfaVerified: false,
  organizationId: "org-acme",
  permissions: ["license.read", "billing.read"],
  role: "CUSTOMER",
  createdAt: "2026-09-01T12:00:00.000Z",
};

export const MOCK_MY_LICENSES: CustomerLicenseView[] = [
  {
    id: "lic-001",
    productId: "aurum-pro",
    productName: "Aurum Pro",
    productSlug: "aurum-pro",
    planName: "Aurum Pro Mensal",
    billingInterval: "MONTH",
    keyMasked: "AURUM-••••-••••-AB12",
    keyPrefix: "AURU",
    keyLast4: "AB12",
    status: "active",
    startsAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2026-11-01T12:00:00.000Z",
    graceUntil: "2026-11-04T12:00:00.000Z",
    degraded: false,
    machinesUsed: 2,
    machinesAllowed: 3,
    origin: "SUBSCRIPTION",
    lastActivity: new Date(Date.now() - 60_000).toISOString(),
    downloadUrls: { windows: "#", macos: "#", web: "#" },
    documentationUrl: "#",
    supportUrl: "#",
  },
  {
    id: "lic-002",
    productId: "aurum-base",
    productName: "Aurum Base",
    productSlug: "aurum-base",
    planName: "Aurum Base Anual",
    billingInterval: "YEAR",
    keyMasked: "AURUM-••••-••••-CD34",
    keyPrefix: "AURU",
    keyLast4: "CD34",
    status: "grace",
    startsAt: "2025-10-10T12:00:00.000Z",
    expiresAt: "2026-10-10T12:00:00.000Z",
    graceUntil: "2026-10-13T12:00:00.000Z",
    degraded: true,
    machinesUsed: 1,
    machinesAllowed: 1,
    origin: "SUBSCRIPTION",
    lastActivity: new Date(Date.now() - 10 * 60_000).toISOString(),
  },
];

export const MOCK_MY_INVOICES: CustomerInvoiceView[] = [
  {
    id: "inv-001",
    amount: 149.9,
    currency: "BRL",
    status: "PAID",
    dueDate: "2026-09-10T12:00:00.000Z",
    paidAt: "2026-09-09T15:30:00.000Z",
    externalId: "chg_asaas_001",
    provider: "ASAAS",
    correlationId: "corr-inv-001",
    productName: "Aurum Pro",
    planName: "Mensal",
  },
  {
    id: "inv-002",
    amount: 149.9,
    currency: "BRL",
    status: "OVERDUE",
    dueDate: "2026-10-05T12:00:00.000Z",
    paidAt: null,
    externalId: "chg_asaas_002",
    provider: "ASAAS",
    correlationId: "corr-inv-002",
    productName: "Aurum Pro",
    planName: "Mensal",
  },
  {
    id: "inv-003",
    amount: 1199.0,
    currency: "BRL",
    status: "PENDING",
    dueDate: "2026-10-15T12:00:00.000Z",
    paidAt: null,
    externalId: "chg_asaas_003",
    provider: "ASAAS",
    correlationId: "corr-inv-003",
    productName: "Aurum Base",
    planName: "Anual",
  },
];

export const MOCK_MY_SUBSCRIPTIONS: CustomerSubscriptionView[] = [
  {
    id: "sub-001",
    planName: "Aurum Pro Mensal",
    status: "ACTIVE",
    amount: 149.9,
    currency: "BRL",
    nextDue: "2026-11-05T12:00:00.000Z",
    externalId: "sub_asaas_001",
    productName: "Aurum Pro",
  },
];

export const MOCK_MY_PROFILE: CustomerProfileData = {
  id: "u-customer-1",
  email: "cliente@aurum.test",
  name: "Carlos Cliente",
  displayName: "Carlos",
  phone: "(11) 3000-0000",
  cellphone: "(11) 99999-0000",
  birthDate: "1990-05-20",
  bio: "Desenvolvedor e entusiasta de tecnologia.",
  address: {
    cep: "01310-100",
    street: "Av. Paulista",
    number: "1000",
    complement: "Cj 101",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    country: "Brasil",
  },
  documents: [
    { id: "doc-1", type: "CPF", numberMasked: "***.***.***-**" },
  ],
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
};

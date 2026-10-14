import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { resolveUpstream, upstreamUnavailableResponse } from "@/lib/upstream";
import type { CheckoutSession, CreateCheckoutRequest } from "@/types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";

type CatalogPlan = {
  id: string;
  productCode: string;
  code: string;
  name: string;
  priceCents: number;
  billingInterval: "MONTH" | "YEAR" | "ONE_TIME";
  status: string;
  features: Array<{ featureCode: string; channel?: string; value?: string }>;
};

async function upstreamJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: never }> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as never;
  return { ok: res.ok, status: res.status, data };
}

/**
 * BFF `POST /api/me/checkout` → checkout pós-pagamento real (Fase 8).
 * Preço e intervalo vêm do CATÁLOGO (server-side) — nunca do cliente.
 * Cria invoice PENDING idempotente por orderId e devolve sessão PENDING.
 * `done` só com licença (ver GET abaixo). Sem backend em prod → 502.
 */
export async function POST(req: NextRequest) {
  const resolved = resolveUpstream();
  if (resolved.kind === "missing") return resolved.response;
  if (resolved.kind === "mock") {
    return NextResponse.json(
      { code: "UPSTREAM_UNAVAILABLE", message: "Checkout exige backend (sem stub de cobrança)." },
      { status: 502 }
    );
  }
  const base = resolved.base;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Entre na sua conta para finalizar a compra." },
      { status: 401 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as Partial<CreateCheckoutRequest>;
  const item = Array.isArray(body.items) ? body.items[0] : undefined;
  if (!item?.productCode || !item?.planId) {
    return NextResponse.json(
      { code: "EMPTY_CART", message: "Escolha um plano para continuar." },
      { status: 400 }
    );
  }
  const qty = item.quantity > 0 ? Math.min(item.quantity, 100) : 1;
  try {
    // 1. Plano vigente do catálogo (preço/intervalo autoritativos).
    const plans = await upstreamJson(
      `${base}/v1/products/${encodeURIComponent(item.productCode)}/plans`
    );
    if (!plans.ok || !Array.isArray(plans.data)) return upstreamUnavailableResponse();
    const plan = (plans.data as CatalogPlan[]).find((p) => p.id === item.planId && p.status === "ACTIVE");
    if (!plan) {
      return NextResponse.json(
        { code: "PLAN_NOT_FOUND", message: "Plano indisponível. Escolha de novo." },
        { status: 400 }
      );
    }
    const totalCents = plan.priceCents * qty;
    // 2. Titular (resolve identity → customers) + espelho billing.
    const me = await upstreamJson(`${base}/v1/customers/me`, {
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!me.ok) return NextResponse.json(me.data, { status: me.status });
    const profile = me.data as { id: string; email?: string; name?: string };
    const mirror = await upstreamJson(`${base}/v1/billing/customers/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
      body: JSON.stringify({ userId: profile.id, email: profile.email, name: profile.name }),
    });
    if (!mirror.ok) return NextResponse.json(mirror.data, { status: mirror.status });
    const billingCustomer = mirror.data as { id: string };
    // 3. Pedido idempotente (orderId do cliente ou novo; replay = mesma sessão).
    const orderId =
      typeof body.orderId === "string" && body.orderId.length >= 8 ? body.orderId : `ord-${randomUUID()}`;
    const order = await upstreamJson(`${base}/v1/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
      body: JSON.stringify({
        orderId,
        customerId: billingCustomer.id,
        productId: plan.productCode,
        planRef: plan.id,
        billingInterval: plan.billingInterval,
        amountCents: totalCents,
        paymentMethod: body.paymentMethod,
      }),
    });
    if (!order.ok) return NextResponse.json(order.data, { status: order.status });
    const s = order.data as {
      orderId: string;
      invoiceId: string;
      invoiceNumber: string;
      amountCents: number;
      billingInterval: string;
      status: string;
    };
    const now = new Date().toISOString();
    const nouve: CheckoutSession = {
      id: s.orderId,
      orderId: s.orderId,
      invoiceId: s.invoiceId,
      items: [
        {
          productId: plan.productCode,
          productCode: plan.productCode,
          productName: item.productCode,
          planId: plan.id,
          planName: plan.name,
          billingInterval: plan.billingInterval,
          priceCents: plan.priceCents,
          quantity: qty,
        },
      ],
      totalCents: s.amountCents,
      currency: "BRL",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: now,
    };
    return NextResponse.json(nouve, { status: 201 });
  } catch {
    return upstreamUnavailableResponse();
  }
}

/**
 * BFF `GET /api/me/checkout?id=` — status do pedido + licença (quando emitida).
 * PENDING enquanto não pago; COMPLETED + licenseId após PaymentConfirmed→licença.
 */
export async function GET(req: NextRequest) {
  const resolved = resolveUpstream();
  if (resolved.kind === "missing") return resolved.response;
  if (resolved.kind === "mock") {
    return NextResponse.json(
      { code: "UPSTREAM_UNAVAILABLE", message: "Checkout exige backend." },
      { status: 502 }
    );
  }
  const base = resolved.base;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "Informe ?id=<orderId>." }, { status: 400 });
  }
  try {
    const order = await upstreamJson(`${base}/v1/billing/checkout/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!order.ok) return NextResponse.json(order.data, { status: order.status });
    const s = order.data as {
      orderId: string;
      invoiceId: string;
      amountCents: number;
      billingInterval: string;
      status: string;
    };
    let licenseId: string | undefined;
    let status: CheckoutSession["status"] = "PENDING";
    if (s.status === "PAID") {
      // Licença emitida pelo consumidor (issue-from-payment)? Resolve pelo produto.
      const lic = await upstreamJson(`${base}/v1/licenses?mine=1`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (lic.ok) {
        const items = ((lic.data as { items?: Array<{ id: string; status: string }> }).items ??
          lic.data) as Array<{ id: string; status: string }>;
        const active = Array.isArray(items) ? items.find((l) => l.status === "active") : undefined;
        if (active) {
          status = "COMPLETED";
          licenseId = active.id;
        }
      }
    }
    const now = new Date().toISOString();
    const out: CheckoutSession = {
      id: s.orderId,
      orderId: s.orderId,
      invoiceId: s.invoiceId,
      items: [],
      totalCents: s.amountCents,
      currency: "BRL",
      status,
      ...(licenseId ? { licenseId } : {}),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: now,
    };
    return NextResponse.json(out);
  } catch {
    return upstreamUnavailableResponse();
  }
}

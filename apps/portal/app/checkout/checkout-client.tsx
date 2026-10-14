"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  QrCode,
  Barcode,
  CreditCard,
  ShieldCheck,
  WifiOff,
  Monitor,
} from "lucide-react";
import { Button, SectionSkeleton } from "@/components/ui";
import { usePortal } from "@/lib/portal-context";
import {
  createCheckout,
  getCheckoutStatus,
  getMe,
  getMyProfile,
  getProduct,
} from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";
import { commercialKindLabel, commercialKindOf } from "@/lib/capabilities";
import type { CheckoutSession, PlanView, ProductView } from "@/types";

type Method = "pix" | "boleto" | "cartao";

const METHODS: Array<{ id: Method; label: string; hint: string; icon: typeof QrCode }> = [
  { id: "pix", label: "Pix", hint: "Aprovação rápida", icon: QrCode },
  { id: "boleto", label: "Boleto", hint: "1–2 dias úteis", icon: Barcode },
  { id: "cartao", label: "Cartão", hint: "Crédito", icon: CreditCard },
];

type Status = "loading" | "empty" | "ready" | "buying" | "pending" | "done" | "error";

export function CheckoutClient({ code, planId }: { code: string | null; planId: string | null }) {
  const { openAuthModal } = usePortal();
  const [status, setStatus] = useState<Status>("loading");
  const [product, setProduct] = useState<ProductView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<Method>("pix");
  const [session, setSession] = useState<CheckoutSession | null>(null);

  const plan: PlanView | null = useMemo(() => {
    if (!product) return null;
    if (planId) return product.plans.find((p) => p.id === planId) ?? null;
    return product.plans.find((p) => p.status === "ATIVO") ?? product.plans[0] ?? null;
  }, [product, planId]);

  useEffect(() => {
    if (!code) {
      setStatus("empty");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    getProduct(code)
      .then((p) => {
        if (cancelled) return;
        if (p.code === "aurum-enterprise") {
          setProduct(p);
          setStatus("empty");
          return;
        }
        setProduct(p);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setError("Não encontramos esse produto. Volte aos planos e escolha de novo.");
          setStatus("error");
        }
      });
    getMe()
      .then((me) => {
        if (!cancelled && me.email) setEmail(me.email);
        if (!cancelled && me.name) setName(me.name);
        return getMyProfile().catch(() => null);
      })
      .then((profile) => {
        if (cancelled || !profile) return;
        if (profile.email) setEmail(profile.email);
        if (profile.name) setName(profile.name);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [code]);

  const confirm = async () => {
    if (!product || !plan) return;
    setError(null);
    setStatus("buying");
    try {
      const result = await createCheckout({
        items: [
          {
            productCode: product.code,
            planId: plan.id,
            quantity: 1,
          },
        ],
        paymentMethod: method,
        successUrl: "/dashboard/faturas",
        cancelUrl: `/checkout?code=${encodeURIComponent(product.code)}&plan=${encodeURIComponent(plan.id)}`,
      });
      if (result.asaasUrl) {
        window.location.href = result.asaasUrl;
        return;
      }
      // Fase 8: sessão nasce PENDING — `done` só com licença (polling abaixo).
      setSession(result);
      setStatus("pending");
    } catch {
      setError("Não foi possível criar seu pedido. Tente de novo em instantes.");
      setStatus("ready");
    }
  };

  // Polling do pedido: PENDING → COMPLETED (licença emitida pós-pagamento).
  useEffect(() => {
    if (status !== "pending" || !session?.orderId) return;
    let cancelled = false;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const s = await getCheckoutStatus(session.orderId as string);
        if (cancelled) return;
        if (s.status === "COMPLETED") {
          setSession(s);
          setStatus("done");
          return;
        }
        if (s.status === "FAILED" || s.status === "EXPIRED") {
          setSession(s);
          setError("Esse pedido não foi adiante. Tente de novo ou fale com a gente.");
          setStatus("error");
          return;
        }
      } catch {
        // Transitório: tenta de novo até o teto.
      }
      if (!cancelled && tries < 120) timer = window.setTimeout(tick, 5000);
    };
    let timer = window.setTimeout(tick, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [status, session]);

  if (status === "loading") {
    return (
      <div role="status" aria-label="Carregando checkout">
        <SectionSkeleton count={3} />
      </div>
    );
  }

  if (status === "empty" || (!product && status !== "buying")) {
    const isEnterprise = product?.code === "aurum-enterprise";
    return (
      <div className="glass-card mx-auto max-w-lg p-8 text-center">
        <h1 className="font-display text-title-page font-bold text-text1">
          {isEnterprise ? "Enterprise é conversado, não clicado" : "Escolha um programa primeiro"}
        </h1>
        <p className="mt-2 text-body text-text2">
          {isEnterprise
            ? "O Enterprise é montado para a sua operação. Fale com a gente e receba uma proposta com preço fechado."
            : "Volte aos programas e escolha Base ou Pro para continuar."}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          {isEnterprise ? (
            <a
              href="mailto:contato@aurumbit.com?subject=Quero%20conhecer%20o%20Aurum%20Enterprise"
              className="btn-primary inline-flex min-h-[52px] items-center justify-center gap-2 rounded-base px-6 text-body font-bold"
            >
              Falar com a AurumBit
            </a>
          ) : (
            <Link
              href="/#produtos"
              className="btn-primary inline-flex min-h-[52px] items-center justify-center gap-2 rounded-base px-6 text-body font-bold"
            >
              Ver programas e preços
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (status === "error" || !product || !plan) {
    return (
      <div className="glass-card mx-auto max-w-lg p-8 text-center" role="alert">
        <h1 className="font-display text-title-page font-bold text-text1">Algo não saiu como esperado</h1>
        <p className="mt-2 text-body text-text2">{error ?? "Tente de novo em instantes."}</p>
        <div className="mt-6">
          <Link
            href="/#produtos"
            className="btn-ghost inline-flex min-h-[44px] items-center justify-center gap-2 rounded-base border border-line2 px-4 text-body font-semibold"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar aos planos
          </Link>
        </div>
      </div>
    );
  }

  if (status === "pending" && session) {
    return (
      <div className="glass-card mx-auto max-w-lg p-8 text-center" role="status">
        <p className="text-micro font-semibold uppercase tracking-wider text-accent">Pedido criado</p>
        <h1 className="mt-1 font-display text-title-page font-bold text-text1">
          {formatCurrency(session.totalCents / 100)}
        </h1>
        <p className="mt-2 text-body text-text2">
          Pedido <span className="font-mono">{session.orderId ?? session.id}</span> ·{" "}
          {method === "pix" ? "Pague com Pix para liberar rapidinho." : method === "boleto" ? "O boleto chega no seu e-mail." : "Conclua o pagamento com cartão."}{" "}
          Esta tela atualiza sozinha quando o pagamento confirmar — a chave chega após a confirmação.
        </p>
        <p className="mt-4 text-caption text-text2">Aguardando pagamento…</p>
      </div>
    );
  }

  if (status === "done" && session) {
    return (
      <div className="glass-card mx-auto max-w-lg p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-ok-soft">
          <Check className="h-7 w-7 text-ok" aria-hidden="true" />
        </div>
        <p className="text-micro font-semibold uppercase tracking-wider text-accent">Pagamento confirmado</p>
        <h1 className="mt-1 font-display text-title-page font-bold text-text1">
          {formatCurrency(session.totalCents / 100)}
        </h1>
        <p className="mt-2 text-body text-text2">
          Pedido <span className="font-mono">{session.orderId ?? session.id}</span>
          {session.licenseId ? (
            <> · Licença <span className="font-mono">{session.licenseId}</span> liberada. Siga o passo a passo de instalação na sua área.</>
          ) : (
            <> · Chave a caminho: confira sua área em instantes.</>
          )}
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="btn-ghost inline-flex min-h-[44px] items-center justify-center gap-2 rounded-base border border-line2 px-4 text-body font-semibold"
          >
            Ir para minha área
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  const canConfirm = name.trim().length > 1 && /.+@.+\..+/.test(email) && status !== "buying";

  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-[1fr_1.1fr]">
      {/* Resumo do que está comprando */}
      <section aria-label="Resumo do pedido" className="glass-card h-fit p-6">
        <p className="text-micro font-semibold uppercase tracking-wider text-accent">Você está levando</p>
        <h1 className="mt-1 font-display text-title-page font-extrabold text-text1">{product.name}</h1>
        <p className="mt-1 text-body text-text2">{plan.name}</p>
        <p className="mt-1 text-caption font-semibold text-accent">
          {commercialKindLabel(commercialKindOf(plan.billingInterval))}
        </p>

        <dl className="mt-5 space-y-3 border-t border-line2 pt-5 text-body">
          <div className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-text2">
              <Monitor className="h-4 w-4 text-accent" aria-hidden="true" />
              Computadores
            </dt>
            <dd className="font-semibold tabular-nums text-text1">
              {product.machinesAllowed}{product.code === "aurum-enterprise" ? "+" : ""}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-text2">
              <WifiOff className="h-4 w-4 text-accent" aria-hidden="true" />
              Uso offline
            </dt>
            <dd className="font-semibold text-text1">Incluído</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-text2">
              <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
              Período
            </dt>
            <dd className="font-semibold text-text1">
              {plan.billingInterval === "MONTH" ? "Mensal" : plan.billingInterval === "YEAR" ? "Anual" : "Único"}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex items-end justify-between border-t border-line2 pt-5">
          <span className="text-body text-text2">Total</span>
          <span className="font-display text-kpi font-extrabold tabular-nums text-accent">
            {formatCurrency(plan.priceCents / 100)}
          </span>
        </div>
        <p className="mt-2 text-caption text-text2">
          Total e condições escritos aqui antes de confirmar. Sem taxa escondida.
        </p>
        <Link
          href="/#produtos"
          className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-body font-medium text-text2 transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Trocar de programa
        </Link>
      </section>

      {/* Comprador + pagamento */}
      <section aria-label="Seus dados e pagamento" className="glass-card h-fit p-6">
        <h2 className="font-display text-headline font-bold text-text1">Seus dados</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="checkout-name" className="label">Nome</label>
            <input
              id="checkout-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              className="input"
            />
          </div>
          <div>
            <label htmlFor="checkout-email" className="label">E-mail</label>
            <input
              id="checkout-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
              className="input"
            />
            <p className="mt-1 text-caption text-text2">
              A chave e o passo a passo chegam neste e-mail. Já tem conta?{" "}
              <button
                type="button"
                onClick={() =>
                  openAuthModal("login", {
                    returnTo: `/checkout?code=${encodeURIComponent(code ?? "")}${planId ? `&plan=${encodeURIComponent(planId)}` : ""}`,
                  })
                }
                className="font-semibold text-accent hover:underline"
              >
                Entrar
              </button>
            </p>
          </div>
        </div>

        <h2 className="mt-6 font-display text-headline font-bold text-text1">Pagamento</h2>
        <div role="radiogroup" aria-label="Forma de pagamento" className="mt-3 grid grid-cols-3 gap-2">
          {METHODS.map(({ id, label, hint, icon: Icon }) => {
            const selected = method === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMethod(id)}
                className={cn(
                  "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-base border p-2 text-center transition-[border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  selected ? "border-accent bg-accent-soft text-text1" : "border-line2 text-text2 hover:border-line3 hover:text-text1"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="text-body font-semibold">{label}</span>
                <span className="text-caption">{hint}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <p role="alert" className="error-text mt-4">{error}</p>
        )}

        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canConfirm}
          isLoading={status === "buying"}
          onClick={confirm}
          className="mt-6"
          rightIcon={<ArrowRight className="h-5 w-5" />}
        >
          Confirmar pedido · {formatCurrency(plan.priceCents / 100)}
        </Button>
        <p className="mt-3 text-center text-caption text-text2">
          Pagamento seguro · Chave liberada após a confirmação · Ajuda em português
        </p>
      </section>
    </div>
  );
}

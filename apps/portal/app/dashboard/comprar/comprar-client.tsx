"use client";

import { useEffect, useState } from "react";
import { ShoppingCart, Check, AlertTriangle, ShieldCheck } from "lucide-react";
import { Card, CardContent, Badge, Button } from "@/components/ui";
import { GoldIcon } from "@/components/ui/GoldIcon";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import { useToastHelpers } from "@/components/ui/Toast";
import { EmptyState } from "@/components/dashboard";
import { listProducts, createCheckout, ApiClientError } from "@/lib/api";
import { formatCurrency, cn } from "@/lib/utils";
import type { ProductView, PlanView } from "@/types";

function intervalLabel(interval: PlanView["billingInterval"]): string {
  if (interval === "MONTH") return "/mês";
  if (interval === "YEAR") return "/ano";
  return "único";
}

export default function ComprarClient() {
  const [products, setProducts] = useState<ProductView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { success, error: showError } = useToastHelpers();

  useEffect(() => {
    setError(null);
    setProducts(null);
    listProducts()
      .then((p) => setProducts(p.data))
      .catch((e: Error) => setError(e.message));
  }, [retryKey]);

  const buy = async (product: ProductView, plan: PlanView) => {
    setBuying(plan.id);
    try {
      // Checkout real via BFF (POST /api/me/checkout → Nest/Asaas).
      // Sem backend o BFF responde 502 visível — nunca simula pedido criado.
      const session = await createCheckout({
        items: [{ productCode: product.code, planId: plan.id, quantity: 1 }],
        paymentMethod: "pix",
      });
      if (session.asaasUrl) {
        success("Pedido criado", `${product.name} · ${plan.name}. Abrindo o pagamento Asaas…`);
        window.location.href = session.asaasUrl;
        return;
      }
      success(
        "Pedido criado",
        `${product.name} · ${plan.name}. Pedido ${session.orderId ?? session.id} aguardando pagamento.`
      );
    } catch (e) {
      if (
        e instanceof ApiClientError &&
        (e.status === 502 || e.code === "UPSTREAM_UNAVAILABLE" || e.code === "UPSTREAM_MISSING")
      ) {
        showError(
          "Checkout indisponível",
          "Backend de cobrança fora do ar. Tente de novo — nenhum pedido foi criado."
        );
      } else {
        showError("Falha ao comprar", e instanceof Error ? e.message : "Tente novamente.");
      }
    } finally {
      setBuying(null);
    }
  };

  if (error) {
    return (
      <div className="glass-card p-8 text-center" role="alert">
        <GoldIcon icon={AlertTriangle} size="lg" variant="soft" className="mx-auto" />
        <h1 className="font-display font-bold text-title-page text-text1 mt-4 mb-2">Erro ao carregar catálogo</h1>
        <p className="text-text2 mb-5">{error}</p>
        <Button variant="primary" onClick={() => setRetryKey((k) => k + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!products) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display font-extrabold text-title-page text-text1">Comprar produtos</h1>
          <p className="text-body text-text2 mt-1">
            Catálogo em tempo real — escolha o plano e ative a licença instantaneamente após o pagamento.
          </p>
        </div>
        <SectionSkeleton count={3} />
      </div>
    );
  }

  const activeProducts = products.filter((p) => p.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-title-page text-text1">Comprar produtos</h1>
        <p className="text-body text-text2 mt-1">
          Catálogo em tempo real — escolha o plano e ative a licença instantaneamente após o pagamento.
        </p>
      </div>

      {activeProducts.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ShoppingCart}
              title="Nenhum produto disponível"
              description="O catálogo está vazio no momento. Volte em breve ou fale com o suporte."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {activeProducts.map((p) => {
            const activePlans = p.plans.filter((pl) => pl.status === "ATIVO");
            const selId = selected[p.id] ?? activePlans[0]?.id;
            const selPlan = activePlans.find((pl) => pl.id === selId) ?? activePlans[0];
            return (
              <Card key={p.id} hover={false}>
                <CardContent>
                  <div className="flex items-start gap-3">
                    <GoldIcon icon={ShoppingCart} size="md" variant="soft" />
                    <div className="flex-1 min-w-0">
                      <h2 className="font-display font-semibold text-text1">{p.name}</h2>
                      <p className="text-body text-text2 mt-0.5">{p.shortDescription ?? p.description?.slice(0, 100)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {p.category && (
                          <Badge variant="gold" size="sm">
                            {p.category}
                          </Badge>
                        )}
                        {p.machinesAllowed > 0 && (
                          <Badge variant="neutral" size="sm">
                            Até {p.machinesAllowed} máquina(s)
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {activePlans.length === 0 ? (
                    <p className="mt-4 text-body text-text2 p-3 rounded-base bg-bg1 border border-line2 text-center">
                      Planos em breve para este produto.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-2" role="radiogroup" aria-label={`Planos de ${p.name}`}>
                      {activePlans.map((pl) => {
                        const isSel = selId === pl.id;
                        return (
                          <button
                            key={pl.id}
                            role="radio"
                            aria-checked={isSel}
                            onClick={() => setSelected((s) => ({ ...s, [p.id]: pl.id }))}
                            className={cn(
                              "w-full p-3 rounded-base border-2 text-left transition-all",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                              isSel
                                ? "border-accent bg-accent-soft shadow-glow-sm"
                                : "border-line2 hover:border-accent/60 bg-transparent"
                            )}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="min-w-0">
                                <span className="block text-body text-text1 font-semibold truncate">{pl.name}</span>
                                <span className="block text-caption text-text3">
                                  {pl.billingInterval === "ONE_TIME"
                                    ? "Pagamento único"
                                    : pl.billingInterval === "MONTH"
                                      ? "Cobrança mensal · cancele quando quiser"
                                      : "Cobrança anual · 2 meses de economia"}
                                </span>
                              </span>
                              <span className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-right">
                                  <span className="mono font-bold text-accent text-headline block leading-tight">
                                    {formatCurrency(pl.priceCents / 100)}
                                  </span>
                                  <span className="text-caption font-normal text-text2">
                                    {intervalLabel(pl.billingInterval)}
                                  </span>
                                </span>
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
                                    isSel ? "border-accent bg-accent text-accent-ink" : "border-line3 text-transparent"
                                  )}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </span>
                              </span>
                            </span>
                            {pl.features && pl.features.length > 0 && (
                              <span className="mt-2 grid gap-1">
                                {pl.features.slice(0, 4).map((f) => (
                                  <span key={f.featureCode} className="flex items-center gap-1.5 text-caption text-text2">
                                    <ShieldCheck className="w-3.5 h-3.5 text-ok flex-shrink-0" aria-hidden="true" />
                                    {f.featureCode}
                                  </span>
                                ))}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selPlan && (
                    <div className="mt-4">
                      <Button
                        variant="primary"
                        fullWidth
                        size="lg"
                        isLoading={buying === selPlan.id}
                        disabled={buying !== null}
                        onClick={() => buy(p, selPlan)}
                        leftIcon={<ShoppingCart className="w-5 h-5" aria-hidden="true" />}
                        aria-label={`Comprar ${p.name} plano ${selPlan.name} por ${formatCurrency(selPlan.priceCents / 100)}`}
                      >
                        Comprar · {formatCurrency(selPlan.priceCents / 100)}
                        {selPlan.billingInterval !== "ONE_TIME" && (
                          <span className="font-normal opacity-80">{intervalLabel(selPlan.billingInterval)}</span>
                        )}
                      </Button>
                    </div>
                  )}

                  <p className="text-caption text-text3 mt-2 text-center">
                    Checkout seguro via Asaas · PIX, boleto ou cartão · licença emitida na confirmação
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

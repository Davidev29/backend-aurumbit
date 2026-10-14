"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Monitor,
  Receipt,
  Repeat,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@/components/ui";
import { GoldIcon } from "@/components/ui/GoldIcon";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { KpiCard, EmptyState, LicenseStatusPill, InvoiceStatusPill } from "@/components/dashboard";
import { getMyLicenses, getMyInvoices, getMySubscriptions } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { CustomerLicenseView, CustomerInvoiceView, CustomerSubscriptionView } from "@/types";

const SPARK_ACTIVE = [2, 3, 3, 4, 5, 4, 6, 7];
const SPARK_GRACE = [0, 1, 0, 2, 1, 2, 1, 1];
const SPARK_BILLING = [1, 0, 2, 1, 3, 2, 3, 2];
const SPARK_SUBS = [1, 1, 2, 2, 3, 3, 4, 4];

export default function DashboardHome() {
  const [licenses, setLicenses] = useState<CustomerLicenseView[] | null>(null);
  const [invoices, setInvoices] = useState<CustomerInvoiceView[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<CustomerSubscriptionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const load = useCallback(() => {
    setError(null);
    setLicenses(null);
    setInvoices(null);
    setSubscriptions(null);
    Promise.all([getMyLicenses(), getMyInvoices(), getMySubscriptions()])
      .then(([l, i, s]) => {
        setLicenses(l);
        setInvoices(i);
        setSubscriptions(s);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load, retryKey]);

  if (error) {
    return (
      <div className="glass-card p-8 text-center" role="alert">
        <GoldIcon icon={AlertTriangle} size="lg" variant="soft" className="mx-auto border-danger/30" />
        <h1 className="font-display font-bold text-title-page text-text1 mt-4 mb-2">Erro ao carregar painel</h1>
        <p className="text-text2 mb-5">{error}</p>
        <Button variant="primary" onClick={() => setRetryKey((k) => k + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!licenses || !invoices || !subscriptions) return <DashboardSkeleton />;

  const activeLicenses = licenses.filter((l) => l.status === "active").length;
  const graceLicenses = licenses.filter((l) => l.status === "grace" || l.degraded);
  const pendingInvoices = invoices.filter((i) => i.status === "PENDING" || i.status === "OVERDUE");
  const overdueTotal = pendingInvoices.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-title-page text-text1">Visão geral</h1>
        <p className="text-body text-text2 mt-1">Acompanhe seus produtos, licenças e pagamentos.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label="Indicadores">
        <div role="listitem">
          <KpiCard
            icon={ShieldCheck}
            label="Licenças ativas"
            value={activeLicenses}
            chip={{
              label: `${activeLicenses} de ${licenses.length} no total`,
              tone: activeLicenses > 0 ? "ok" : "neutral",
            }}
            spark={SPARK_ACTIVE}
          />
        </div>
        <div role="listitem">
          <KpiCard
            icon={Clock}
            label="Em tolerância"
            value={graceLicenses.length}
            chip={{
              label: graceLicenses.length > 0 ? "Atenção necessária" : "Tudo saudável",
              tone: graceLicenses.length > 0 ? "warn" : "ok",
            }}
            spark={SPARK_GRACE}
          />
        </div>
        <div role="listitem">
          <KpiCard
            icon={Receipt}
            label="Faturas pendentes"
            value={pendingInvoices.length}
            chip={{
              label: pendingInvoices.length > 0 ? `${formatCurrency(overdueTotal)} em aberto` : "Nada em aberto",
              tone: pendingInvoices.length > 0 ? "danger" : "ok",
            }}
            spark={SPARK_BILLING}
          />
        </div>
        <div role="listitem">
          <KpiCard
            icon={Repeat}
            label="Assinaturas"
            value={subscriptions.length}
            chip={{
              label: subscriptions.length === 1 ? "1 plano recorrente" : `${subscriptions.length} planos recorrentes`,
              tone: "info",
            }}
            spark={SPARK_SUBS}
          />
        </div>
      </div>

      {graceLicenses.length > 0 && (
        <div className="glass-card p-4 border-warn flex items-start gap-3" role="alert">
          <GoldIcon icon={AlertTriangle} size="sm" variant="soft" />
          <div>
            <p className="font-semibold text-text1">
              Você tem {graceLicenses.length} licença(s) em tolerância degradada
            </p>
            <p className="text-body text-text2">Renove ou quite as faturas em aberto para restaurar o acesso pleno.</p>
            <Link
              href="/dashboard/faturas"
              className="inline-flex items-center gap-1 text-accent font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            >
              Ver faturas <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            action={
              <Link
                href="/dashboard/sistemas"
                className="text-body text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                Ver todos
              </Link>
            }
          >
            <CardTitle subtitle={`${licenses.length} licença(s) no total`}>Meus sistemas</CardTitle>
          </CardHeader>
          <CardContent>
            {licenses.length === 0 ? (
              <EmptyState
                icon={Monitor}
                title="Nenhum sistema liberado"
                description="Compre um produto para ativar sua primeira licença."
                action={
                  <Link href="/dashboard/comprar" className="btn-primary btn">
                    Comprar produtos
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-3" aria-label="Licenças recentes">
                {licenses.slice(0, 4).map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center gap-3 p-3 rounded-base border border-line2 hover:border-accent/40 transition-colors"
                  >
                    <GoldIcon icon={Monitor} size="sm" variant="soft" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-text1 truncate">{l.productName}</p>
                      <p className="text-caption text-text2 mono truncate">{l.keyMasked}</p>
                    </div>
                    <LicenseStatusPill status={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            action={
              <Link
                href="/dashboard/faturas"
                className="text-body text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                Ver todas
              </Link>
            }
          >
            <CardTitle subtitle={pendingInvoices.length ? `${formatCurrency(overdueTotal)} em aberto` : "Nada em aberto"}>
              Próximas faturas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingInvoices.length === 0 ? (
              <div className="flex items-start gap-3 p-4 rounded-base bg-ok-soft border border-ok/30">
                <CheckCircle2 className="w-5 h-5 text-ok flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-body text-text1">Nenhuma fatura pendente. Tudo em dia.</p>
              </div>
            ) : (
              <ul className="space-y-3" aria-label="Faturas em aberto">
                {pendingInvoices.slice(0, 4).map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center gap-3 p-3 rounded-base border border-line2 hover:border-accent/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-text1 truncate">{i.productName ?? i.id}</p>
                      <p className="text-caption text-text2">Vence {formatDate(i.dueDate)}</p>
                    </div>
                    <span className="font-mono font-semibold text-text1 whitespace-nowrap">
                      {formatCurrency(i.amount)}
                    </span>
                    <InvoiceStatusPill status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <GoldIcon icon={ShoppingCart} size="md" variant="gold" />
            <div className="flex-1">
              <p className="font-display font-semibold text-text1">Precisa de mais um produto?</p>
              <p className="text-body text-text2">Explore o catálogo e ative novas licenças instantaneamente.</p>
            </div>
            <Link
              href="/dashboard/comprar"
              className="btn-primary btn focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30"
            >
              Comprar produtos
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

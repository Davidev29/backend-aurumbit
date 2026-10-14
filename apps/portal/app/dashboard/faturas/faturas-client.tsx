"use client";

import { useEffect, useMemo, useState } from "react";
import { Receipt, Download, AlertTriangle, ExternalLink, CreditCard } from "lucide-react";
import { Card, CardContent, Button } from "@/components/ui";
import { GoldIcon } from "@/components/ui/GoldIcon";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { useToastHelpers } from "@/components/ui/Toast";
import { EmptyState, InvoiceStatusPill } from "@/components/dashboard";
import { getMyInvoices } from "@/lib/api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { CustomerInvoiceView } from "@/types";

const statusMeta: Record<CustomerInvoiceView["status"], { label: string }> = {
  PAID: { label: "Paga" },
  PENDING: { label: "Pendente" },
  OVERDUE: { label: "Vencida" },
  REFUNDED: { label: "Estornada" },
  CANCELLED: { label: "Cancelada" },
};

const filters = ["all", "PENDING", "OVERDUE", "PAID", "REFUNDED", "CANCELLED"] as const;
type Filter = (typeof filters)[number];

export default function FaturasClient() {
  const [invoices, setInvoices] = useState<CustomerInvoiceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [retryKey, setRetryKey] = useState(0);
  const { info, success } = useToastHelpers();

  useEffect(() => {
    setError(null);
    setInvoices(null);
    getMyInvoices()
      .then(setInvoices)
      .catch((e: Error) => setError(e.message));
  }, [retryKey]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: invoices?.length ?? 0,
      PENDING: 0,
      OVERDUE: 0,
      PAID: 0,
      REFUNDED: 0,
      CANCELLED: 0,
    };
    invoices?.forEach((i) => {
      c[i.status] += 1;
    });
    return c;
  }, [invoices]);

  if (error) {
    return (
      <div className="glass-card p-8 text-center" role="alert">
        <GoldIcon icon={AlertTriangle} size="lg" variant="soft" className="mx-auto" />
        <h1 className="font-display font-bold text-title-page text-text1 mt-4 mb-2">Erro ao carregar faturas</h1>
        <p className="text-text2 mb-5">{error}</p>
        <Button variant="primary" onClick={() => setRetryKey((k) => k + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!invoices) return <DashboardSkeleton />;

  const filtered = filter === "all" ? invoices : invoices.filter((i) => i.status === filter);
  const total = filtered.reduce((s, i) => s + i.amount, 0);

  const handlePay = (i: CustomerInvoiceView) => {
    info("Checkout Asaas", `Fatura ${i.id} · ${formatCurrency(i.amount)}. PIX, boleto ou cartão.`);
  };

  const handlePdf = (i: CustomerInvoiceView) => {
    if (i.downloadUrl) {
      window.open(i.downloadUrl, "_blank", "noopener,noreferrer");
    } else {
      success("Comprovante", `PDF da fatura ${i.id} será gerado após a confirmação do pagamento.`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-title-page text-text1">Faturas</h1>
        <p className="text-body text-text2 mt-1">Histórico de cobranças, vencimentos e comprovantes.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar faturas">
        {filters.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={cn(
              "badge px-4 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              s === filter ? "badge-gold" : "badge-neutral hover:border-accent/50"
            )}
          >
            {s === "all" ? "Todas" : statusMeta[s].label}
            <span className="ml-1 opacity-70 mono">{counts[s]}</span>
          </button>
        ))}
      </div>

      <Card padding="none">
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nenhuma fatura neste filtro"
              description="Ajuste o filtro acima ou fale com o financeiro se esperava uma cobrança aqui."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body min-w-[720px]" role="table" aria-label="Faturas">
                <thead className="sticky top-0 z-10 bg-bg1">
                  <tr className="border-b border-line2 text-left">
                    <th scope="col" className="py-3 px-4 font-semibold text-text2 whitespace-nowrap">
                      Fatura
                    </th>
                    <th scope="col" className="py-3 pr-4 font-semibold text-text2">
                      Produto
                    </th>
                    <th scope="col" className="py-3 pr-4 font-semibold text-text2 whitespace-nowrap">
                      Vencimento
                    </th>
                    <th scope="col" className="py-3 pr-4 font-semibold text-text2 text-right whitespace-nowrap">
                      Valor
                    </th>
                    <th scope="col" className="py-3 pr-4 font-semibold text-text2">
                      Estado
                    </th>
                    <th scope="col" className="py-3 px-4 font-semibold text-text2 text-right">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id} className="border-b border-line2 last:border-0 hover:bg-bg2/50 transition-colors">
                      <td className="py-3 px-4 mono text-text1 whitespace-nowrap">{i.id}</td>
                      <td className="py-3 pr-4 text-text1">
                        {i.productName ?? "—"}
                        {i.planName && <span className="block text-caption text-text3">{i.planName}</span>}
                      </td>
                      <td className="py-3 pr-4 text-text2 whitespace-nowrap">{formatDate(i.dueDate)}</td>
                      <td className="py-3 pr-4 text-right mono font-semibold text-text1 whitespace-nowrap" data-numeric>
                        {formatCurrency(i.amount)}
                      </td>
                      <td className="py-3 pr-4">
                        <InvoiceStatusPill status={i.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          {(i.status === "PENDING" || i.status === "OVERDUE") &&
                            (i.downloadUrl ? (
                              <a
                                href={i.downloadUrl}
                                className="btn btn-primary min-h-[36px] px-3 py-1.5 text-caption rounded-sm inline-flex items-center gap-1.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <CreditCard className="w-4 h-4" aria-hidden="true" />
                                Pagar
                              </a>
                            ) : (
                              <Button
                                variant="primary"
                                size="sm"
                                leftIcon={<CreditCard className="w-4 h-4" aria-hidden="true" />}
                                onClick={() => handlePay(i)}
                                aria-label={`Pagar fatura ${i.id}`}
                              >
                                Pagar
                              </Button>
                            ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<Download className="w-4 h-4" aria-hidden="true" />}
                            onClick={() => handlePdf(i)}
                            aria-label={`Baixar PDF da fatura ${i.id}`}
                          >
                            PDF
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 sm:px-6 py-4 border-t border-line2 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
            <span className="text-body text-text2">
              {filtered.length} fatura(s) · total{" "}
              <strong className="mono text-text1">{formatCurrency(total)}</strong>
            </span>
            <a
              href="mailto:financeiro@aurumbit.com"
              className="text-body text-accent hover:underline inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            >
              Falar com financeiro <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-start gap-3">
            <GoldIcon icon={Receipt} size="sm" variant="soft" />
            <div className="text-body text-text2">
              <p className="font-semibold text-text1">Como funciona a cobrança</p>
              <p className="mt-1">
                Faturas via Asaas (PIX, boleto ou cartão). Após a confirmação do pagamento a licença é
                emitida/renovada automaticamente e o comprovante fica disponível aqui.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

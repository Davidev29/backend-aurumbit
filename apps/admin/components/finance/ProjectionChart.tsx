"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { TimezoneBadge } from "@/components/shell/TimezoneBadge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, Td, Th } from "@/components/ui/table";
import { getFinanceFacets, getProjection } from "@/lib/finance";
import { formatBRL } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { Period, ProjectionResponse } from "@/lib/types";

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: "week", label: "Semanal" },
  { value: "month", label: "Mensal" },
  { value: "year", label: "Anual" },
];

const SELECT_CLASS =
  "w-full min-h-[44px] px-3 rounded-base text-body text-text1 bg-bg2 border border-line2 focus-ring";

/**
 * Projeção receita×despesa (Fase 5 — agrega realizado + previsto por bucket).
 * Filtros: período week/month/year + produto/categoria. Inclui TimezoneBadge
 * (fuso operacional America/Sao_Paulo) e tabela alternativa acessível
 * (WCAG AA: gráfico nunca é o único meio de leitura dos valores).
 * DS v1 (visual apenas): container/tooltip/legenda em tokens; lib (recharts)
 * e dados intocados.
 */
export function ProjectionChart() {
  const [period, setPeriod] = useState<Period>("month");
  const [category, setCategory] = useState("");
  const [product, setProduct] = useState("");
  const [facets, setFacets] = useState<{ categories: string[]; products: string[] }>({
    categories: [],
    products: [],
  });
  const [data, setData] = useState<ProjectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const { notify } = useToast();
  // Snapshot desatualizado NÃO quebra o layout: sai só por toast (uma vez por snapshot).
  const staleNotifiedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFinanceFacets()
      .then((f) => {
        if (!cancelled) setFacets(f);
      })
      .catch(() => {
        if (!cancelled) setFacets({ categories: [], products: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProjection(period, category || null, product || null)
      .then((p) => {
        if (!cancelled) setData(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar projeção.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, category, product, nonce]);

  useEffect(() => {
    if (!data?.isStale) return;
    const key = `fin-projection|${period}|${data.asOf}`;
    if (staleNotifiedRef.current === key) return;
    staleNotifiedRef.current = key;
    notify("warn", "Projeção possivelmente desatualizada", data.staleReason ?? "Snapshot desatualizado.");
  }, [data, period, notify]);

  return (
    <div>
      <form
        aria-label="Filtros da projeção"
        className="flex gap-3 flex-wrap mb-4 items-end"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="mb-4">
          <p id="proj-period-label" className="block mb-1 font-semibold text-headline">
            Período
          </p>
          <div
            role="group"
            aria-labelledby="proj-period-label"
            className="inline-flex overflow-hidden rounded-base border border-line2 bg-bg1"
          >
            {PERIOD_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={period === o.value}
                onClick={() => setPeriod(o.value)}
                className={
                  period === o.value
                    ? "min-h-[44px] px-4 text-body bg-bg2 font-semibold text-text1 focus-ring"
                    : "min-h-[44px] px-4 text-body text-text2 hover:text-text1 focus-ring"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Categoria" htmlFor="proj-category">
          <select
            id="proj-category"
            className={SELECT_CLASS}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas</option>
            {facets.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Produto" htmlFor="proj-product">
          <select
            id="proj-product"
            className={SELECT_CLASS}
            value={product}
            onChange={(e) => setProduct(e.target.value)}
          >
            <option value="">Todos</option>
            {facets.products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <div className="ml-auto">
          <TimezoneBadge />
        </div>
      </form>

      {loading ? (
        <Skeleton height="18rem" label="Carregando projeção" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : !data || data.points.length === 0 ? (
        <EmptyState
          title="Sem dados de projeção"
          message="Ajuste período, categoria ou produto."
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCategory("");
                setProduct("");
              }}
            >
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <>
          <div
            className="rounded-card bg-bg1 border border-line1 shadow-1 p-4"
            role="img"
            aria-label={`Gráfico de barras receita versus despesa por ${period === "week" ? "semana" : period === "month" ? "mês" : "ano"}: ${data.points.map((p) => `${p.bucket}: receita ${formatBRL(p.receita)}, despesa ${formatBRL(p.despesa)}`).join("; ")}`}
          >
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={data.points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-1)" />
                <XAxis dataKey="bucket" stroke="var(--text-2)" tick={{ fontSize: 12, fill: "var(--text-2)" }} />
                <YAxis
                  stroke="var(--text-2)"
                  tick={{ fontSize: 12, fill: "var(--text-2)" }}
                  tickFormatter={(v: number) => `R$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                />
                <Tooltip
                  formatter={(value, name) => [
                    formatBRL(Number(value ?? 0)),
                    name === "receita" ? "Receita" : "Despesa",
                  ]}
                  contentStyle={{
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 12,
                    color: "var(--text-1)",
                  }}
                  labelStyle={{ color: "var(--text-1)" }}
                  itemStyle={{ color: "var(--text-1)" }}
                />
                <Legend
                  formatter={(v: string) => (v === "receita" ? "Receita" : "Despesa")}
                  wrapperStyle={{ color: "var(--text-2)" }}
                />
                <Bar dataKey="receita" fill="#46a758" name="receita" radius={[4, 4, 0, 0]} />
                <Bar dataKey="despesa" fill="#e5484d" name="despesa" radius={[4, 4, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="receita"
                  stroke="#e8b34b"
                  dot={false}
                  name="receita (tendência)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Alternativa textual acessível (WCAG AA): mesmos valores em tabela. */}
          <details className="mt-3">
            <summary>Ver dados em tabela (alternativa ao gráfico)</summary>
            <div className="mt-2">
              <Table
                caption={`Projeção receita × despesa (${data.points.length} buckets)`}
                head={
                  <>
                    <Th>Bucket</Th>
                    <Th numeric>Receita</Th>
                    <Th numeric>Despesa</Th>
                    <Th numeric>Saldo</Th>
                  </>
                }
              >
                {data.points.map((p) => (
                  <tr key={p.bucket}>
                    <Td mono>{p.bucket}</Td>
                    <Td numeric mono>
                      {formatBRL(p.receita)}
                    </Td>
                    <Td numeric mono>
                      {formatBRL(p.despesa)}
                    </Td>
                    <Td numeric mono>
                      {formatBRL(p.receita - p.despesa)}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import type { Period } from "@/lib/types";

// TODO(backend pronto): buscar KPIs em `/v1/metrics/*` por período.
const KPI_BY_PERIOD: Record<Period, { mrr: number; active: number; overdue: number; created: number }> = {
  week: { mrr: 12480.5, active: 312, overdue: 11, created: 18 },
  month: { mrr: 48230.0, active: 1204, overdue: 46, created: 73 },
  year: { mrr: 512900.0, active: 8930, overdue: 210, created: 640 },
};

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("month");
  const kpis = KPI_BY_PERIOD[period];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-title-page text-text1">Painel</h1>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      <div
        aria-busy="false"
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <KpiCard label="Receita (período)" value={kpis.mrr} kind="currency" hint="Stub Fase 2" />
        <KpiCard label="Licenças ativas" value={kpis.active} hint="Stub Fase 2" />
        <KpiCard label="Pagamentos em atraso" value={kpis.overdue} hint="Stub Fase 2" />
        <KpiCard label="Novos clientes" value={kpis.created} hint="Stub Fase 2" />
      </div>
    </div>
  );
}

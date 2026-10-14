"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePerm } from "@/lib/auth/permissions";
import { listNotifications, markNotificationRead, type FinanceNotificationView } from "@/lib/finance";
import { formatDateTimeInTZ } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { useOrgStore } from "@/stores/org-store";
import { useMe } from "@/lib/auth/permissions";

type Filter = "todas" | "nao-lidas";

const SEVERITY_LABEL: Record<FinanceNotificationView["severity"], string> = {
  INFO: "Informação",
  WARN: "Atenção",
  ERROR: "Crítica",
};

const SEVERITY_DOT: Record<FinanceNotificationView["severity"], string> = {
  INFO: "bg-accent",
  WARN: "bg-[#b7791f]",
  ERROR: "bg-danger",
};

/**
 * Central de notificações (rota própria `/notificacoes`).
 * Único histórico permanente de alertas: o sino apenas resume; os toasts são
 * o canal de envio em tempo real. Leitura é idempotente.
 */
export default function NotificacoesPage() {
  const { me } = useMe();
  const { orgId } = useOrgStore();
  const activeOrg = orgId ?? me?.organizationId ?? null;
  const { notify } = useToast();
  const [filter, setFilter] = useState<Filter>("todas");
  const [items, setItems] = useState<FinanceNotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [marking, setMarking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listNotifications(false);
      setItems(res.data);
      setUnread(res.unread);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar notificações.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  async function handleRead(n: FinanceNotificationView) {
    if (n.read || marking) return;
    setMarking(n.id);
    try {
      await markNotificationRead(n.id);
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      setUnread((u) => Math.max(0, u - 1));
      notify("success", "Notificação marcada como lida", n.title);
    } catch (err) {
      notify("error", "Não foi possível marcar como lida", err instanceof Error ? err.message : undefined);
    } finally {
      setMarking(null);
    }
  }

  async function handleReadAll() {
    const pending = items.filter((i) => !i.read);
    if (pending.length === 0 || marking) return;
    setMarking("__all__");
    try {
      await Promise.all(pending.map((n) => markNotificationRead(n.id)));
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      setUnread(0);
      notify("success", "Todas as notificações foram marcadas como lidas");
    } catch (err) {
      notify("error", "Falha ao marcar todas como lidas", err instanceof Error ? err.message : undefined);
    } finally {
      setMarking(null);
    }
  }

  const visible = filter === "nao-lidas" ? items.filter((i) => !i.read) : items;

  return (
    <RequirePerm perm="finance.read" organizationId={activeOrg}>
      <div className="flex flex-col gap-8">
        <section className="flex flex-wrap items-start justify-between gap-4" aria-labelledby="notif-title">
          <div>
            <p className="m-0 flex items-center gap-2 text-micro font-bold uppercase tracking-wider text-text2">
              <Bell size={16} strokeWidth={1.75} aria-hidden="true" />
              Central de alertas
            </p>
            <h1 id="notif-title" className="m-0 mt-1 text-title-page">
              Notificações {unread > 0 && <span className="text-callout font-normal text-text2">({unread} não lidas)</span>}
            </h1>
            <p className="mb-0 mt-2 max-w-2xl text-body text-text2">
              Alertas operacionais chegam por toast em tempo real e ficam registrados aqui. Nada é enviado por
              banner solto ou pop-up nativo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={handleReadAll} disabled={unread === 0 || marking !== null}>
              <CheckCheck size={20} strokeWidth={1.75} aria-hidden="true" />
              Marcar todas como lidas
            </Button>
            <Link href="/financeiro" className="no-underline">
              <span className="inline-flex min-h-[44px] items-center rounded-base border border-line2 bg-bg2 px-4 text-body font-semibold text-text1">
                Voltar ao financeiro
              </span>
            </Link>
          </div>
        </section>

        <section
          aria-label="Filtros da central"
          className="rounded-card border border-line1 bg-bg1 p-5 shadow-1"
        >
          <div role="radiogroup" aria-label="Filtrar notificações" className="flex flex-wrap gap-2">
            {(
              [
                { id: "todas", label: "Todas" },
                { id: "nao-lidas", label: "Não lidas" },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={filter === o.id}
                onClick={() => setFilter(o.id)}
                className={
                  filter === o.id
                    ? "min-h-[44px] rounded-full border border-accent bg-accentsoft px-4 text-body font-semibold text-text1 focus-ring"
                    : "min-h-[44px] rounded-full border border-line2 bg-bg2 px-4 text-body text-text2 hover:text-text1 focus-ring"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        <section aria-label="Lista de notificações" className="rounded-card border border-line1 bg-bg1 p-5 shadow-1">
          {loading ? (
            <Skeleton height="12rem" label="Carregando notificações" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
          ) : visible.length === 0 ? (
            <EmptyState
              title={filter === "nao-lidas" ? "Nada pendente" : "Sem notificações"}
              message={
                filter === "nao-lidas"
                  ? "Todas as notificações já foram lidas."
                  : "Novos alertas do financeiro aparecem aqui e por toast."
              }
              action={
                <Button type="button" variant="secondary" onClick={() => setNonce((n) => n + 1)}>
                  Recarregar
                </Button>
              }
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {visible.map((n) => (
                <li
                  key={n.id}
                  className={`flex flex-wrap items-start gap-3 rounded-card border p-4 ${
                    n.read ? "border-line1 bg-bg2" : "border-accent bg-accentsoft"
                  }`}
                >
                  <span aria-hidden="true" className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${SEVERITY_DOT[n.severity]}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`m-0 text-body ${n.read ? "text-text2" : "font-semibold text-text1"}`}>
                      {n.title}
                      <span className="ml-2 inline-block rounded-full border border-line2 px-2 py-0.5 align-middle text-micro font-normal text-text2">
                        {SEVERITY_LABEL[n.severity]}
                      </span>
                    </p>
                    <p className="mb-0 mt-1 text-body text-text2">{n.body}</p>
                    <p className="mb-0 mt-1 text-callout text-text2">
                      <time dateTime={n.createdAt}>{formatDateTimeInTZ(n.createdAt)}</time>
                      {n.read ? " · lida" : " · não lida"}
                    </p>
                  </div>
                  {!n.read && (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={marking !== null}
                      onClick={() => void handleRead(n)}
                      title="Marcar como lida"
                    >
                      {marking === n.id ? "Marcando…" : "Marcar como lida"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </RequirePerm>
  );
}

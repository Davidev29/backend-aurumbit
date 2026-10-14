"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StaleBanner } from "@/components/feedback/StaleBanner";
import { TimezoneBadge } from "@/components/shell/TimezoneBadge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { EmptyState, ErrorState, Table, Td, Th } from "@/components/ui/table";
import { RequirePerm, useCan } from "@/lib/auth/permissions";
import { formatDateTimeInTZ } from "@/lib/format";
import { getDlqOverview, replayDlq, type DlqOverview, type DlqQueueDepth } from "@/lib/queues";

/**
 * Filas / DLQ replay (Fase 6 — stub admin).
 * Gate: `billing.manage` (só admin) no middleware (redirect) + RequirePerm
 * (Forbidden). Lista depth por fila + replay com confirmação (motivo >= 10 +
 * checkbox) + audit (`queue.replay` no backend real).
 * TODO(backend real Fase 6): o Nest expõe `GET /v1/queues/dlq` (depth real) e
 * `POST /v1/queues/dlq/:queue/replay` (re-enfileira); hoje o BFF responde
 * stub a partir de `lib/mocks.ts`.
 */
export default function FilasPage() {
  const [overview, setOverview] = useState<DlqOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [replayTarget, setReplayTarget] = useState<DlqQueueDepth | null>(null);
  // `mode` é forward-compatible: o BFF real expõe `mode:"logical"`
  // (replay lógico, sem re-enqueue real); o stub ainda não o retorna.
  const [lastReplay, setLastReplay] = useState<{
    queue: string;
    replayed: number;
    auditId: string;
    mode?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDlqOverview()
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar filas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return (
    <RequirePerm perm="billing.manage">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 text-title-page text-text1">Filas</h1>
          <TimezoneBadge />
        </div>

        {overview?.isStale && (
          <StaleBanner
            message={overview.staleReason}
            asOf={overview.asOf}
            onRetry={() => setNonce((n) => n + 1)}
          />
        )}

        {lastReplay && (
          <div role="status" className="mb-4 rounded-card border border-ok bg-bg1 p-4 shadow-1">
            <p className="m-0 text-body text-text1">
              Replay na fila <code className="font-mono tnum text-[0.85em]">{lastReplay.queue}</code>{" "}
              ({lastReplay.mode ?? "logical"}): {lastReplay.replayed} mensagem(ns) re-enfileirada(s).
              Auditoria{" "}
              <Link
                href={`/auditoria?correlationId=${encodeURIComponent(lastReplay.auditId)}`}
                className="font-mono tnum text-[0.85em] text-info hover:underline focus-ring"
              >
                {lastReplay.auditId}
              </Link>
              .
            </p>
          </div>
        )}

        <p className="mt-0 text-callout text-text2">
          Replay lógico (<code className="font-mono tnum text-[0.85em]">mode:logical</code>) — sem
          re-enqueue real; cada replay é auditado.
        </p>

        {loading ? (
          <div
            role="status"
            aria-label="Carregando filas"
            className="animate-shimmer rounded-base border border-line1"
            style={{
              height: "12rem",
              background: "linear-gradient(90deg, var(--bg-2) 25%, var(--border-2) 50%, var(--bg-2) 75%)",
              backgroundSize: "200% 100%",
            }}
          />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : !overview || overview.queues.length === 0 ? (
          <div className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
            <EmptyState title="Nenhuma fila monitorada" hint="Nenhuma fila DLQ configurada no broker." />
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" onClick={() => setNonce((n) => n + 1)} title="Recarregar filas">
                Atualizar
              </Button>
            </div>
          </div>
        ) : (
          <Table
            caption="Profundidade DLQ por fila"
            head={
              <>
                <Th>Fila</Th>
                <Th numeric>Profundidade</Th>
                <Th>Mais antiga</Th>
                <Th>Último erro</Th>
                <Th>Ações</Th>
              </>
            }
          >
            {overview.queues.map((q) => (
              <tr key={q.queue}>
                <Td mono>{q.queue}</Td>
                <Td numeric>{q.depth}</Td>
                <Td>{q.oldestEnqueuedAt ? formatDateTimeInTZ(q.oldestEnqueuedAt) : "—"}</Td>
                <Td>{q.lastError ?? "—"}</Td>
                <Td>
                  <Button
                    variant="primary"
                    disabled={q.depth === 0}
                    title={q.depth === 0 ? "Fila vazia — nada a re-enfileirar" : "Re-enfileirar DLQ (auditado)"}
                    onClick={() => setReplayTarget(q)}
                  >
                    Replay
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}

        {replayTarget && (
          <ReplayDialog
            queue={replayTarget}
            onClose={() => setReplayTarget(null)}
            onDone={(r) => {
              setReplayTarget(null);
              setLastReplay(r);
              setNonce((n) => n + 1);
            }}
          />
        )}
      </div>
    </RequirePerm>
  );
}

function ReplayDialog({
  queue,
  onClose,
  onDone,
}: {
  queue: DlqQueueDepth;
  onClose: () => void;
  onDone: (r: { queue: string; replayed: number; auditId: string; mode?: string }) => void;
}) {
  const canReplay = useCan("billing.manage");
  const [motivo, setMotivo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = motivo.trim().length >= 10 && confirmed;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const r = (await replayDlq(queue.queue, { motivo: motivo.trim(), confirmacao: true })) as {
        queue: string;
        replayed: number;
        auditId: string;
        mode?: string;
      };
      onDone(r);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao re-enfileirar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Replay DLQ — ${queue.queue}`}
      pending={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending} title="Fechar sem re-enfileirar">
            Voltar
          </Button>
          <Button
            variant="primary"
            disabled={!valid || pending || !canReplay}
            title={!valid ? "Informe o motivo (mín. 10 caracteres) e confirme" : "Confirmar replay auditado"}
            onClick={() =>
              (document.getElementById("dlq-replay-form") as HTMLFormElement | null)?.requestSubmit()
            }
          >
            {pending ? "Re-enfileirando…" : "Confirmar replay"}
          </Button>
        </>
      }
    >
      <RequirePerm perm="billing.manage">
        <p className="mt-0 text-body text-text2">
          {queue.depth} mensagem(ns) da fila <code className="font-mono text-[0.85em]">{queue.queue}</code> serão
          re-enfileiradas para processamento. A ação é auditada (
          <code className="font-mono text-[0.85em]">queue.replay</code>).
        </p>
        <form id="dlq-replay-form" onSubmit={handleSubmit}>
          <Field label="Motivo (mín. 10 caracteres, auditado)" htmlFor="dlq-replay-motivo">
            <textarea
              id="dlq-replay-motivo"
              rows={3}
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={!canReplay || pending}
              className="min-h-[44px] w-full rounded-base border border-line2 bg-bg2 px-3 py-2 text-body text-text1 focus-ring"
            />
          </Field>
          <label
            htmlFor="dlq-replay-confirm"
            className="flex min-h-[44px] cursor-pointer items-center gap-2 text-body text-text1"
          >
            <input
              id="dlq-replay-confirm"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={!canReplay || pending}
              className="h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            Confirmo o replay e entendo que é auditado
          </label>
          {error && (
            <p className="mb-0 mt-3 text-callout text-danger" role="alert">
              {error}
            </p>
          )}
        </form>
      </RequirePerm>
    </Dialog>
  );
}

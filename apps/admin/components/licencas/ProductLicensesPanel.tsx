"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  CalendarClock,
  CircleCheck,
  Cpu,
  Info,
  Plus,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, Pager, Table, Td, Th } from "@/components/ui/table";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { GraceBadge } from "@/components/licencas/GraceBadge";
import { LicenseKeyMasked } from "@/components/licencas/LicenseKeyMasked";
import { ExtendDialog } from "@/components/licencas/dialogs/ExtendDialog";
import { RenewDialog } from "@/components/licencas/dialogs/RenewDialog";
import { ResumeDialog } from "@/components/licencas/dialogs/ResumeDialog";
import { RevokeDialog } from "@/components/licencas/dialogs/RevokeDialog";
import { SuspendDialog } from "@/components/licencas/dialogs/SuspendDialog";
import { useCan } from "@/lib/auth/permissions";
import { formatDateTimeInTZ } from "@/lib/format";
import { listProductLicenses } from "@/lib/products";
import type {
  LicenseEffectiveStatus,
  LicenseStatus,
  MaskedProductLicense,
  ProductLicensesPage,
} from "@/lib/types";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 25;

/** Filtros de estado com rótulo pt-BR. `null` = todas. */
const FILTERS: Array<{ id: LicenseEffectiveStatus | null; label: string }> = [
  { id: null, label: "Todas" },
  { id: "active", label: "Ativas" },
  { id: "grace", label: "Em graça" },
  { id: "expired", label: "Expiradas" },
  { id: "suspended", label: "Suspensas" },
  { id: "revoked", label: "Revogadas" },
  { id: "pending_payment", label: "Pagamento pendente" },
];

/**
 * Regras de ação por estado — a UI esconde o que não faz sentido, e o backend
 * (409) continua sendo a última linha. Cada linha existe por um `ConflictException`
 * específico em `licenses.service.ts`:
 *
 * | estado            | prorrogar | suspender | reativar | renovar | revogar |
 * |-------------------|-----------|-----------|----------|---------|---------|
 * | active            | sim       | sim       | —        | sim     | sim     |
 * | grace             | sim       | sim       | —        | sim     | sim     |
 * | expired           | sim       | — ¹      | —        | sim     | sim ²   |
 * | suspended         | sim ³     | —         | sim      | — ⁴     | sim     |
 * | revoked           | — ⁵       | —         | —        | — ⁵     | —       |
 * | pending_payment   | — ⁶       | —         | —        | — ⁶     | sim     |
 * | vitalícia (sem expiresAt) | — ⁷ | sim | —    | — ⁷     | sim     |
 *
 * ¹ expirada não pode ser suspensa ("renove" é o caminho) · ² revogação em
 * expirada é legal (o direito acabou mesmo) · ³ backend PERMITE prorrogar
 * suspensa: a suspensão é estado de admin, independente das datas · ⁴
 * "licença suspensa: retome antes de renovar" · ⁵ `REVOKED_NO_EXTEND` /
 * revogada não renova (terminal) · ⁶ `PENDING_NO_EXTEND` — ainda não pagou ·
 * ⁷ `LIFETIME_NO_EXTEND` / `LIFETIME_NO_RENEW` — não há o que prorrogar.
 */
function canExtend(l: MaskedProductLicense): boolean {
  if (String(l.status) === "revoked") return false;
  if (String(l.status) === "pending_payment") return false;
  // Vitalícia / linha legada sem expiresAt: nada a prorrogar (409 do upstream).
  return typeof l.expiresAt === "string" && l.expiresAt !== "";
}
function canSuspend(l: MaskedProductLicense): boolean {
  const s = String(l.status);
  return s === "active" || s === "grace";
}
function canResume(l: MaskedProductLicense): boolean {
  return String(l.status) === "suspended";
}
function canRenew(l: MaskedProductLicense): boolean {
  const s = String(l.status);
  if (s === "revoked" || s === "pending_payment" || s === "suspended") return false;
  return typeof l.expiresAt === "string" && l.expiresAt !== "";
}
function canRevoke(l: MaskedProductLicense): boolean {
  return String(l.status) !== "revoked";
}

/** Motivo pelo qual a ação está bloqueada (vai no `title`/`aria-label`). */
function blockedReason(l: MaskedProductLicense, action: "extend" | "renew"): string | null {
  const s = String(l.status);
  const lifetime = typeof l.expiresAt !== "string" || l.expiresAt === "";
  if (s === "revoked") return "Licença revogada: estado terminal, não há o que prorrogar nem renovar.";
  if (s === "pending_payment") return "Pagamento pendente: a licença ainda não foi paga.";
  if (lifetime && action === "extend") return "Licença vitalícia: não há vencimento a prorrogar.";
  if (lifetime && action === "renew") return "Licença vitalícia: não precisa de renovação.";
  if (s === "suspended" && action === "renew") return "Licença suspensa: reative antes de renovar.";
  return null;
}

const KIND_LABEL: Record<string, string> = {
  monthly: "Mensal",
  annual: "Anual",
  lifetime: "Vitalícia",
  trial: "Trial",
};

function kindBadge(kind: string) {
  const k = kind.toLowerCase();
  if (k === "lifetime") {
    return (
      <Badge tone="ok" state="Licença vitalícia">
        <CircleCheck size={11} strokeWidth={1.75} aria-hidden="true" />
        Vitalícia
      </Badge>
    );
  }
  if (k === "trial") {
    return (
      <Badge tone="info" state="Chave de teste">
        Trial
      </Badge>
    );
  }
  if (k === "monthly" || k === "annual") {
    return <Badge tone="accent">{KIND_LABEL[k]}</Badge>;
  }
  return null;
}

/**
 * Vencimento COM HORA (`formatDateTimeInTZ`, fuso America/Sao_Paulo).
 *
 * O usuário pediu "mostrar até a hora que uma licença se vence" — e com razão:
 * o token offline é validado por `off_exp` no mesmo instante, então dia sem
 * hora esconde o corte real. O backend já manda ISO-8601 com hora; aqui não se
 * arredonda (ao contrário do `formatDateInTZ` do histórico, que cortava o dia).
 */
function expiryCell(l: MaskedProductLicense) {
  if (!l.expiresAt) {
    return (
      <span className="text-callout text-text2">
        sem expiração
        <span className="block font-mono text-[11px]">vitalícia</span>
      </span>
    );
  }
  const d = new Date(l.expiresAt);
  const passed = d.getTime() <= Date.now();
  return (
    <>
      <time dateTime={l.expiresAt} className={cn("font-mono tnum text-[0.85em]", passed && "text-text2")}>
        {formatDateTimeInTZ(l.expiresAt)}
      </time>
      {l.graceUntil && (
        <span className="block text-[11px] text-text2">
          graça até {formatDateTimeInTZ(l.graceUntil)}
        </span>
      )}
      {passed && (
        <span className="block text-[11px] text-text2">
          {new Date(l.graceUntil ?? 0).getTime() > Date.now() ? "vencida, dentro da tolerância" : "vencida"}
        </span>
      )}
    </>
  );
}

/** Badge de estado — reusa `GraceBadge` (5 estados com ícone + tom, já pronto). */
function statusCell(l: MaskedProductLicense) {
  const raw = String(l.status);
  const known: LicenseStatus[] = ["active", "grace", "suspended", "expired", "revoked"];
  if (!known.includes(raw as LicenseStatus)) {
    // Estado fora do conjunto conhecido (ex.: `pending_payment`) — texto legível
    // em vez de crashar o badge (o tipo widened é `string & {}` de propósito).
    return <Badge tone="info">{raw}</Badge>;
  }
  return <GraceBadge status={raw as LicenseStatus} graceUntil={l.graceUntil ?? undefined} />;
}

/**
 * Aba "Licenças" do modal de produto: o estado ATUAL das chaves.
 *
 * Complementar (não substitutiva) à aba "Histórico": histórico é a trilha
 * append-only do que aconteceu; aqui é "como estão as chaves agora". Era esta
 * leitura que faltava — chaves vencidas apareciam como "Ativa" porque a UI só
 * tinha o histórico, cujos estados vinham errados.
 *
 * Estados não-funcionais do DS §9 preservados: SkeletonTable (carregando),
 * ErrorState + retry (falha), EmptyState (sem chave / filtro sem resultado).
 */
export function ProductLicensesPanel({
  productCode,
  onChanged,
}: {
  productCode: string;
  /** Avisa o pai p/ recarregar o produto (contadores da aba Visão geral). */
  onChanged?: () => void;
}) {
  const canManage = useCan("license.adjust");
  const [filter, setFilter] = useState<LicenseEffectiveStatus | null>(null);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ProductLicensesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "extend" | "suspend" | "resume" | "renew" | "revoke"; license: MaskedProductLicense }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listProductLicenses(productCode, { limit: PAGE_SIZE, offset })
      .then((res) => {
        if (!cancelled) setPage(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setPage(null);
        setError(err instanceof Error ? err.message : "Falha ao carregar as licenças.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productCode, offset, nonce]);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
    onChanged?.();
  }, [onChanged]);

  const items = page?.items ?? [];

  /** Contagem por estado DENTRO da página carregada (honesto: rotula como tal). */
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of items) c.set(String(l.status), (c.get(String(l.status)) ?? 0) + 1);
    return c;
  }, [items]);

  // Filtro no cliente de propósito: a contagem por estado só é exata sobre o
  // conjunto carregado. Filtrar no servidor traria uma página já contada, mas
  // esconderia os demais estados (que é o que o operador quer ver) e zeraria a
  // contagem dos filtros vizinhos. A etiqueta abaixo diz o escopo do número.
  const filtered = useMemo(
    () => (filter ? items.filter((l) => String(l.status) === filter) : items),
    [items, filter],
  );

  function handleActionDone(msg: string) {
    setNotice(msg);
    reload();
  }

  if (loading && !page) {
    return <SkeletonTable rows={4} label="Carregando licenças do produto" />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />;
  }
  if (!page) return null;

  const isStub = page.mode === "stub";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p id="lic-filter-label" className="m-0 text-[11px] font-bold uppercase tracking-wide text-text2">
          Licenças
        </p>
        <Badge tone="accent" state={`${page.total} ${page.total === 1 ? "chave emitida" : "chaves emitidas"}`}>
          {page.total} {page.total === 1 ? "chave" : "chaves"}
        </Badge>
        {isStub && (
          <Badge tone="warn" state="Dados sintéticos: API_INTERNAL_URL ausente">
            Stub
          </Badge>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="ml-auto shrink-0"
          onClick={reload}
          title="Recarregar o estado atual das chaves"
          aria-label="Recarregar licenças"
        >
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
          Recarregar
        </Button>
      </div>

      {isStub && (
        <p className="mb-2 flex items-start gap-1.5 rounded-base border border-line2 bg-bg2 px-2.5 py-1.5 text-callout text-text2">
          <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
          <span>
            <code className="font-mono text-[0.85em]">API_INTERNAL_URL</code> ausente: estas chaves são{" "}
            <strong className="text-text1">sintéticas</strong>, não dados reais de cliente.
          </span>
        </p>
      )}

      {notice && (
        <p
          className="mb-2 flex items-center gap-1.5 rounded-base border border-line1 bg-bg2 px-2.5 py-1.5 text-callout text-text1"
          role="status"
        >
          <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-accent" />
          {notice}
        </p>
      )}

      {/* Filtro por estado em SELECT (DS: contagem textual, nunca só cor). */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label htmlFor="lic-filter-select" className="m-0 text-[11px] font-bold uppercase tracking-wide text-text2">
          Filtro
        </label>
        <select
          id="lic-filter-select"
          value={filter ?? ""}
          onChange={(e) => {
            setFilter((e.target.value === "" ? null : e.target.value) as LicenseEffectiveStatus | null);
            setOffset(0);
          }}
          className="min-h-[36px] rounded-base border border-line2 bg-bg2 px-2.5 text-callout font-semibold text-text1 focus-ring"
          aria-labelledby="lic-filter-label"
        >
          {FILTERS.map((f) => {
            const n = f.id === null ? items.length : (counts.get(f.id) ?? 0);
            return (
              <option key={f.id ?? "all"} value={f.id ?? ""}>
                {f.label} ({n})
              </option>
            );
          })}
        </select>
      </div>
      <p className="mt-0 text-[11px] text-text2">
        Contagens sobre as {items.length} {items.length === 1 ? "chave carregada" : "chaves carregadas"}
        {page.hasMore ? ` de ${page.total} no total` : ""}.
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="Sem licenças emitidas"
          message="Nenhuma chave foi emitida para este produto ainda. Licenças nascem na compra."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={`Nenhuma chave ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase() ?? ""}`}
          message="Troque o filtro para ver as chaves nos outros estados."
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => setFilter(null)}>
              Ver todas
            </Button>
          }
        />
      ) : (
        <>
          <Table
            caption="Estado atual das licenças deste produto (vencimento com hora, fuso America/Sao_Paulo)"
            head={
              <>
                <Th>Chave</Th>
                <Th>Estado</Th>
                <Th>Vencimento</Th>
                <Th>Modalidade</Th>
                <Th>Titular</Th>
                <Th numeric>Máquinas</Th>
                <Th>Ações</Th>
              </>
            }
          >
            {filtered.map((l) => {
              const extendWhy = blockedReason(l, "extend");
              const renewWhy = blockedReason(l, "renew");
              const showExtend = canExtend(l);
              const showSuspend = canSuspend(l);
              const showResume = canResume(l);
              const showRenew = canRenew(l);
              const showRevoke = canRevoke(l);
              return (
                <tr key={l.id}>
                  <Td>
                    <LicenseKeyMasked licenseId={l.id} keyMasked={l.keyMasked} />
                  </Td>
                  <Td>{statusCell(l)}</Td>
                  <Td mono>{expiryCell(l)}</Td>
                  <Td>{kindBadge(l.kind)}</Td>
                  <Td>
                    <span className="text-callout" title={l.ownerId}>
                      {l.ownerLabel || l.ownerId}
                    </span>
                    <span className="block text-[11px] text-text2">{l.ownerType}</span>
                  </Td>
                  <Td numeric>
                    <span
                      className="inline-flex items-center gap-1"
                      title={`Limite de ${l.maxDevices ?? "—"} máquina(s) nesta licença`}
                    >
                      <Cpu size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                      {l.maxDevices ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      {/* Ações sempre no DOM (layout estável ao mudar de estado),
                          com `disabled` carregando o MOTIVO no `title` (DS §9:
                          "disabled + title"). Um botão que parece habilitado e
                          não faz nada seria pior que um botão apagado. */}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="px-2"
                        disabled={!canManage || !showExtend}
                        title={
                          !canManage
                            ? "Requer permissão license.adjust"
                            : showExtend
                              ? "Prorrogar a MESMA licença (preserva a chave e os vínculos de máquina)"
                              : (extendWhy ?? "Prorrogação indisponível")
                        }
                        aria-label={`Prorrogar licença ${l.keyMasked}`}
                        onClick={() => showExtend && setDialog({ kind: "extend", license: l })}
                      >
                        <CalendarClock size={13} strokeWidth={1.75} aria-hidden="true" />
                        Prorrogar
                      </Button>
                      {showSuspend ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="px-2"
                          disabled={!canManage}
                          title={
                            canManage
                              ? "Bloquear temporariamente (a chave volta com Reativar)"
                              : "Requer permissão license.adjust"
                          }
                          aria-label={`Suspender licença ${l.keyMasked}`}
                          onClick={() => setDialog({ kind: "suspend", license: l })}
                        >
                          <Ban size={13} strokeWidth={1.75} aria-hidden="true" />
                          Suspender
                        </Button>
                      ) : showResume ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="px-2"
                          disabled={!canManage}
                          title={
                            canManage
                              ? "Reativar licença suspensa"
                              : "Requer permissão license.adjust"
                          }
                          aria-label={`Reativar licença ${l.keyMasked}`}
                          onClick={() => setDialog({ kind: "resume", license: l })}
                        >
                          <CircleCheck size={13} strokeWidth={1.75} aria-hidden="true" />
                          Reativar
                        </Button>
                      ) : null}
                      {/* Renovar EMITE chave nova (≠ prorrogar) — desabilitado onde
                          o upstream dá 409: revoked/pending_payment/suspended/vitalícia. */}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="px-2"
                        disabled={!canManage || !showRenew}
                        title={
                          !canManage
                            ? "Requer permissão license.adjust"
                            : showRenew
                              ? "Renovar: emite uma chave NOVA (a antiga fica como histórico)"
                              : (renewWhy ?? "Renovação indisponível")
                        }
                        aria-label={`Renovar licença ${l.keyMasked}`}
                        onClick={() => showRenew && setDialog({ kind: "renew", license: l })}
                      >
                        <Plus size={13} strokeWidth={1.75} aria-hidden="true" />
                        Renovar
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="px-2"
                        disabled={!canManage || !showRevoke}
                        title={
                          !canManage
                            ? "Requer permissão license.adjust"
                            : showRevoke
                              ? "Revogar: invalida tokens (irreversível por esta tela)"
                              : "Licença já revogada: estado terminal."
                        }
                        aria-label={`Revogar licença ${l.keyMasked}`}
                        onClick={() => showRevoke && setDialog({ kind: "revoke", license: l })}
                      >
                        Revogar
                      </Button>
                      {!showRevoke && !showExtend && !showRenew && !showSuspend && !showResume && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-text2">
                          <Info size={12} strokeWidth={1.75} aria-hidden="true" />
                          estado terminal
                        </span>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
          {page.total > 0 && (page.hasMore || offset > 0) && (
            <Pager
              hasPrev={offset > 0}
              hasNext={page.hasMore}
              onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              onNext={() => setOffset((o) => o + PAGE_SIZE)}
              status={`${offset + 1}–${Math.min(offset + items.length, page.total)} de ${page.total}`}
            />
          )}
        </>
      )}

      <p className="mt-2 mb-0 text-callout text-text2">
        Chaves sempre mascaradas. <strong>Prorrogar</strong> mantém a chave e os vínculos de máquina;
        <strong> Renovar</strong> emite uma chave nova. Revelar a chave exige{" "}
        <code className="font-mono text-[0.85em]">license.read</code> + MFA (rate-limit 10/h, auditado).
      </p>

      {dialog?.kind === "extend" && (
        <ExtendDialog
          licenseId={dialog.license.id}
          keyMasked={dialog.license.keyMasked}
          expiresAt={dialog.license.expiresAt}
          onClose={() => setDialog(null)}
          onDone={(exp) =>
            handleActionDone(
              `Licença ${dialog.license.keyMasked} prorrogada${exp ? ` — novo vencimento ${formatDateTimeInTZ(exp)}` : ""}.`,
            )
          }
        />
      )}
      {dialog?.kind === "suspend" && (
        <SuspendDialog
          licenseId={dialog.license.id}
          keyMasked={dialog.license.keyMasked}
          expiresAt={dialog.license.expiresAt}
          onClose={() => setDialog(null)}
          onDone={() => handleActionDone(`Licença ${dialog.license.keyMasked} suspensa.`)}
        />
      )}
      {dialog?.kind === "resume" && (
        <ResumeDialog
          licenseId={dialog.license.id}
          keyMasked={dialog.license.keyMasked}
          expiresAt={dialog.license.expiresAt}
          graceUntil={dialog.license.graceUntil}
          onClose={() => setDialog(null)}
          onDone={() => handleActionDone(`Licença ${dialog.license.keyMasked} reativada.`)}
        />
      )}
      {dialog?.kind === "renew" && dialog.license.expiresAt && (
        <RenewDialog
          licenseId={dialog.license.id}
          expiresAt={dialog.license.expiresAt}
          onClose={() => setDialog(null)}
          onDone={(exp) => handleActionDone(`Licença ${dialog.license.keyMasked} renovada — ${formatDateTimeInTZ(exp)}.`)}
        />
      )}
      {dialog?.kind === "revoke" && (
        <RevokeDialog
          licenseId={dialog.license.id}
          keyMasked={dialog.license.keyMasked}
          onClose={() => setDialog(null)}
          onDone={() => handleActionDone(`Licença ${dialog.license.keyMasked} revogada.`)}
        />
      )}
    </div>
  );
}

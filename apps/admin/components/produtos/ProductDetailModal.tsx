"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Ban,
  Box,
  Calendar,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  Cpu,
  Info,
  MonitorSmartphone,
  Pencil,
  Plus,
  Ticket,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/table";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Field, Input } from "@/components/ui/Field";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ProductLicensesPanel } from "@/components/licencas/ProductLicensesPanel";
import { PlatformIcons } from "./PlatformPicker";
import { deliveryModeLabel } from "@/lib/platforms";
import { useCan } from "@/lib/auth/permissions";
import { useToast } from "@/lib/toast";
import { apiPost } from "@/lib/api/client";
import { formatBRL, formatDateInTZ, formatDateTimeInTZ } from "@/lib/format";
import { deleteProductImage, getProduct, getProductActiveClients, listLicenseHistory, uploadProductImage } from "@/lib/products";
import type {
  LicenseHistoryEntry,
  PlanView,
  ProductActiveClient,
  ProductImage,
  ProductView,
} from "@/lib/types";
import { ArchiveDialog } from "./ArchiveDialog";
import { ChangePriceDialog } from "./ChangePriceDialog";
import { EditProductDialog } from "./EditProductDialog";

/**
 * Abas do detalhe. `licenses` (estado ATUAL das chaves) e `history` (trilha
 * append-only do que aconteceu) são coisas DIFERENTES e ambas ficam: o
 * operador precisa das duas para responder "quantas chaves vencidas existem
 * agora?" e "quem suspendeu esta chave em março?".
 */
type TabId = "overview" | "plans" | "licenses" | "history" | "gallery" | "promo";

/** Badge de estado do produto (ícone + texto, nunca só cor — DS §9). */
export function ProductStatusBadge({ status }: { status: ProductView["status"] }) {
  if (status === "ACTIVE") {
    return (
      <Badge tone="ok" state="Ativo">
        <CircleCheck size={13} strokeWidth={1.75} aria-hidden="true" />
        Ativo
      </Badge>
    );
  }
  if (status === "DRAFT") {
    return (
      <Badge tone="warn" state="Rascunho">
        <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
        Rascunho
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" state="Arquivado" icon={Archive}>
      Arquivado
    </Badge>
  );
}

/**
 * Badge de estado na trilha de HISTÓRICO.
 *
 * Fonte da verdade = `currentStatus` (o estado efetivo AGORA, derivado do
 * relógio pelo backend), com `status` da entrada como fallback para linhas
 * legadas. `derivedFromClock` acende o cue "vigência" — sem ele, o operador lê
 * "Ativa" numa emissão de 2024 e conclui que o dado está errado, quando na
 * verdade é o relógio falando.
 *
 * O tipo antes era `"active" | "revoked" | "expired"`, o que não cobria `grace`,
 * `suspended` nem `pending_payment` — esses caíam no fallback cru e apareciam
 * como texto solto (`grace`) no lugar de um badge. Agora os 6 estados efetivos
 * + `replaced` têm tom e ícone.
 */
function historyBadge(entry: LicenseHistoryEntry) {
  const raw = String(entry.currentStatus ?? entry.status ?? "").toLowerCase();
  const derived = entry.derivedFromClock === true;
  const cue = derived ? " (vigência)" : "";
  if (raw === "active" || raw === "ativa") {
    return (
      <Badge tone="ok" state={`Ativa${cue}`}>
        <CircleCheck size={13} strokeWidth={1.75} aria-hidden="true" />
        Ativa
      </Badge>
    );
  }
  if (raw === "grace") {
    return (
      <Badge tone="warn" state={`Em graça${cue}`}>
        <TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
        Em graça
      </Badge>
    );
  }
  if (raw === "suspended" || raw === "suspensa") {
    return (
      <Badge tone="warn" state={`Suspensa${cue}`}>
        <Ban size={13} strokeWidth={1.75} aria-hidden="true" />
        Suspensa
      </Badge>
    );
  }
  if (raw === "revoked" || raw === "revogada") {
    return (
      <Badge tone="danger" state={`Revogada${cue}`}>
        <CircleX size={13} strokeWidth={1.75} aria-hidden="true" />
        Revogada
      </Badge>
    );
  }
  if (raw === "replaced" || raw === "substituida" || raw === "substituída") {
    return (
      <Badge tone="info" state="Substituída">
        <Info size={13} strokeWidth={1.75} aria-hidden="true" />
        Substituída
      </Badge>
    );
  }
  if (raw === "expired" || raw === "expirada") {
    return (
      <Badge tone="neutral" state={`Expirada${cue}`} icon={Archive}>
        Expirada
      </Badge>
    );
  }
  if (raw === "pending_payment" || raw === "pending") {
    return (
      <Badge tone="info" state={`Pagamento pendente${cue}`}>
        <Info size={13} strokeWidth={1.75} aria-hidden="true" />
        Pagamento pendente
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" state={String(entry.currentStatus ?? entry.status)}>
      {String(entry.currentStatus ?? entry.status)}
    </Badge>
  );
}

/** Linha de plano com versionamento de preço (`status`/`validFrom`/`validTo`/`supersededBy`). */
type PlanRow = PlanView;

function isSubstituted(p: PlanRow): boolean {
  return p.status === "SUBSTITUIDO";
}

function formatValidity(p: PlanRow): string {
  const from = formatDateInTZ(p.validFrom);
  const to = p.validTo ? formatDateInTZ(p.validTo) : "vigente";
  return `${from} – ${to}`;
}

function minPrice(plans: PlanRow[]): number | null {
  const vigentes = plans.filter((p) => !isSubstituted(p));
  if (vigentes.length === 0) return null;
  return Math.min(...vigentes.map((p) => p.priceCents));
}

/** Mini-estatística (rótulo 10px + valor callout) — grade densa 2×2. */
function MiniStat({
  icon,
  label,
  value,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="rounded-base border border-line1 bg-bg2 px-2 py-1.5" title={title ?? value}>
      <p className="m-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-text2">
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
        {label}
      </p>
      <p className="m-0 mt-0.5 truncate text-callout font-semibold text-text1">{value}</p>
    </div>
  );
}

type ActiveClientRow = ProductActiveClient;

/** Linha técnica (rótulo + valor mono + copiar) p/ conferência do operador. */
function TechRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-text2">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono tnum text-[0.85em] text-text1" title={value}>
        {value}
      </code>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0 px-2"
        onClick={onCopy}
        title={copied ? "Copiado!" : `Copiar ${label.toLowerCase()}`}
        aria-label={copied ? `${label} copiado` : `Copiar ${label.toLowerCase()}`}
      >
        {copied ? (
          <Check size={13} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
        )}
      </Button>
    </li>
  );
}

/** Bloco de detalhes técnicos do produto (identidade + timestamps + versões). */
function TechDetails({ product }: { product: ProductView }) {
  const { notify } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const extra = product as ProductView & {
    updatedAt?: string;
    versions?: Array<{ version: string }>;
  };

  async function handleCopy(key: string, value: string) {
    const ok = await copyText(value);
    if (ok) {
      setCopied(key);
      notify("success", "Copiado", value);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } else {
      notify("warn", "Não foi possível copiar", "Selecione o valor manualmente (Ctrl+C).");
    }
  }

  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: "id", label: "ID", value: product.id },
    { key: "code", label: "Código", value: product.code },
    { key: "slug", label: "Slug", value: product.slug },
    { key: "status", label: "Status", value: product.status },
    { key: "created", label: "Criado em", value: formatDateTimeInTZ(product.createdAt) },
  ];
  if (extra.updatedAt) rows.push({ key: "updated", label: "Atualizado em", value: formatDateTimeInTZ(extra.updatedAt) });
  rows.push({
    key: "versions",
    label: "Versões",
    value: extra.versions && extra.versions.length > 0 ? extra.versions.map((v) => v.version).join(", ") : "—",
  });

  return (
    <section aria-label="Detalhes técnicos do produto" className="rounded-base border border-line1 bg-bg1 px-2.5 py-2">
      <p className="m-0 mb-1 text-[10px] font-bold uppercase tracking-wide text-text2">
        Detalhes técnicos
      </p>
      <ul className="m-0 divide-y divide-line1 p-0 list-none">
        {rows.map((r) => (
          <TechRow
            key={r.key}
            label={r.label}
            value={r.value}
            copied={copied === r.key}
            onCopy={() => handleCopy(r.key, r.value)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Clientes ativos em lista inline (máx. 5) — sem card alto nem tabela. */
function ActiveClientsInline({ productCode }: { productCode: string }) {
  const [rows, setRows] = useState<ActiveClientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setRows(null);
    getProductActiveClients(productCode)
      .then((res) => {
        if (!cancelled) setRows(Array.isArray(res) ? res : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setError(err instanceof Error ? err.message : "Falha ao carregar clientes ativos.");
      });
    return () => {
      cancelled = true;
    };
  }, [productCode, nonce]);

  if (rows === null && !error) {
    return (
      <section aria-label="Clientes com licenças ativas" className="rounded-base border border-line1 bg-bg1 px-2.5 py-2">
        <SkeletonTable rows={2} label="Carregando clientes ativos" />
      </section>
    );
  }

  if (error) {
    return (
      <section aria-label="Clientes com licenças ativas" className="rounded-base border border-line1 bg-bg1 px-2.5 py-2">
        <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
      </section>
    );
  }

  const list = rows ?? [];
  if (list.length === 0) {
    return (
      <section aria-label="Clientes com licenças ativas" className="rounded-base border border-line1 bg-bg1 px-2.5 py-2">
        <p className="m-0 flex items-center gap-1.5 text-callout text-text2">
          <Users size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          Nenhum cliente com licença ativa ou em graça.
        </p>
      </section>
    );
  }

  const totalActive = list.reduce((acc, r) => acc + r.active, 0);
  const totalGrace = list.reduce((acc, r) => acc + r.grace, 0);
  const visible = list.slice(0, 5);
  const rest = list.length - visible.length;
  const summary = `${list.length} ${list.length === 1 ? "cliente" : "clientes"} · ${totalActive} ${totalActive === 1 ? "ativa" : "ativas"}${totalGrace > 0 ? ` · ${totalGrace} em graça` : ""}`;

  return (
    <section aria-label="Clientes com licenças ativas" className="rounded-base border border-line1 bg-bg1 px-2.5 py-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="m-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-text2">
          <Users size={13} strokeWidth={1.75} aria-hidden="true" />
          Clientes ativos
        </p>
        <Badge tone="accent" state={summary}>
          {summary}
        </Badge>
      </div>
      <ul className="m-0 grid gap-1 p-0 list-none">
        {visible.map((r) => (
          <li
            key={r.customerId}
            className="flex items-center gap-2 rounded-base bg-bg2 px-2 py-1 text-callout"
          >
            <span className="min-w-0 flex-1 truncate text-text1">{r.customerName}</span>
            <span className="shrink-0 font-mono tnum text-[0.85em] text-text2">
              {r.active} ativa{r.active === 1 ? "" : "s"}
              {r.grace > 0 ? ` · ${r.grace} graça` : ""}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="m-0 mt-1 text-callout text-text2">
          +{rest} {rest === 1 ? "outro cliente" : "outros clientes"}.
        </p>
      )}
    </section>
  );
}

/** Linha de plano vigente: nome + ciclo, preço à direita, ação compacta. */
function PlanRows({
  plans,
  canManage,
  archived,
  onChangePrice,
}: {
  plans: PlanRow[];
  canManage: boolean;
  archived: boolean;
  onChangePrice: (p: PlanView) => void;
}) {
  return (
    <ul aria-label="Planos vigentes" className="m-0 divide-y divide-line1 p-0 list-none rounded-base border border-line1 bg-bg1 px-2.5">
      {plans.map((p) => (
        <li key={p.id} className="flex items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-callout font-semibold text-text1" title={p.name}>
              {p.name}{" "}
              <span className="ml-1 inline-flex align-middle">
                {p.billingInterval === "MONTH" ? (
                  <Badge tone="accent" state="Pacote mensal">Mensal</Badge>
                ) : (
                  <Badge tone="info" state="Pacote anual">Anual</Badge>
                )}
              </span>
            </p>
          </div>
          <span className="shrink-0 font-mono tnum text-[0.85em] text-text1">
            {formatBRL(p.priceCents / 100)}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0 whitespace-nowrap"
            onClick={() => onChangePrice(p)}
            disabled={!canManage || archived}
            title={
              archived
                ? "Produto arquivado"
                : canManage
                  ? `Alterar preço do plano ${p.name}`
                  : "Requer permissão product.manage"
            }
            aria-label={`Alterar preço do plano ${p.name}`}
          >
            Alterar preço
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Histórico de preços em linhas compactas (dentro de `<details>`). */
function PriceHistoryRows({ plans }: { plans: PlanRow[] }) {
  return (
    <ul aria-label="Histórico de preços" className="m-0 grid gap-1 p-0 list-none">
      {plans.map((p) => (
        <li key={p.id} className="flex items-center gap-2 rounded-base bg-bg2 px-2 py-1 text-callout">
          <span className="shrink-0 font-mono tnum text-[0.85em] text-text1">{formatBRL(p.priceCents / 100)}</span>
          <span className="min-w-0 flex-1 truncate text-text2">{formatValidity(p)}</span>
          <Badge tone="neutral" state="Substituído" icon={Archive}>
            Substituído
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Chip de modalidade da licença (origem comercial visível na linha). */
function modalityBadge(h: LicenseHistoryEntry) {
  const kind = (h.kind ?? "").toLowerCase();
  const owner = (h.ownerType ?? "").toUpperCase();
  if (owner === "PROMO" || kind === "trial") {
    return (
      <Badge tone="info" state="Chave demonstrativa" className="px-1.5 py-px">
        <Ticket size={11} strokeWidth={1.75} aria-hidden="true" />
        Demo
      </Badge>
    );
  }
  if (kind === "lifetime") {
    return (
      <Badge tone="ok" state="Licença vitalícia" className="px-1.5 py-px">
        <CircleCheck size={11} strokeWidth={1.75} aria-hidden="true" />
        Vitalícia
      </Badge>
    );
  }
  if (kind === "monthly" || kind === "annual") {
    return (
      <Badge tone="accent" state={kind === "monthly" ? "Assinatura mensal" : "Assinatura anual"} className="px-1.5 py-px">
        {kind === "monthly" ? "Assinatura · Mensal" : "Assinatura · Anual"}
      </Badge>
    );
  }
  return null;
}

/** Heurística documentada: bônus vive em entitlements (outro domínio) — aqui
 * sinalizamos o que chegou rotulado como bônus no motivo/rótulo da licença. */
function isBonusTagged(h: LicenseHistoryEntry): boolean {
  return /bônus|bonus/i.test(`${h.reason ?? ""} ${h.ownerLabel ?? ""}`);
}

/**
 * Texto de expiração da linha (COM HORA — `formatDateTimeInTZ`).
 *
 * Antes usava `formatDateInTZ`, que corta o dia: a trilha escondia o momento
 * exato em que a vigência acaba. O backend já entrega ISO-8601 com hora e a
 * tolerância é de 3 dias — o corte no dia hides essa precisão.
 */
function expiryText(h: LicenseHistoryEntry): string | null {
  if (h.expiresAt) return `expira ${formatDateTimeInTZ(h.expiresAt)}`;
  if ((h.kind ?? "").toLowerCase() === "lifetime") return "sem expiração";
  return null;
}

/** Rótulo do evento que originou a linha (trilha append-only do outbox). */
function eventLabel(h: LicenseHistoryEntry): string | null {
  if (!h.eventType) return null;
  const map: Record<string, string> = {
    LicenseIssued: "emissão",
    LicenseRenewed: "renovação",
    LicenseExtended: "prorrogação",
    LicenseResumed: "reativação",
    LicenseRevoked: "revogação",
    LicenseSuspended: "suspensão",
  };
  return map[h.eventType] ?? h.eventType;
}

/** Histórico de licenças em linhas compactas (chave + motivo / estado + data). */
function LicenseRows({ history }: { history: LicenseHistoryEntry[] }) {
  return (
    <ul aria-label="Histórico de licenças" className="m-0 divide-y divide-line1 p-0 list-none rounded-base border border-line1 bg-bg1 px-2.5">
      {history.map((h, i) => {
        const modality = modalityBadge(h);
        const expiry = expiryText(h);
        const bonus = isBonusTagged(h);
        const event = eventLabel(h);
        const motive = h.reason || (h.replacedBy ? `→ ${h.replacedBy}` : null);
        // `occurredAt` (quando o evento aconteceu) > `endedAt` (quando a licença
        // terminou) — `occurredAt` é o campo correto para ordenar a trilha.
        const when = h.occurredAt ?? h.endedAt;
        return (
          <li key={`${h.licenseId}-${h.eventType ?? "evt"}-${i}`} className="flex items-center gap-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate font-mono tnum text-[0.85em] leading-5 text-text1" title={h.replacedBy ? `Substituída por ${h.replacedBy}` : undefined}>
                {h.keyMasked}
              </p>
              {motive && (
                <p className="m-0 truncate text-[11px] leading-4 text-text2" title={motive}>
                  {motive}
                </p>
              )}
              {(modality || expiry || bonus || event) && (
                <p className="m-0 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 leading-4">
                  {modality}
                  {event && (
                    <Badge tone="neutral" state={`Evento: ${h.eventType}`} icon={false} className="px-1.5 py-px">
                      {event}
                    </Badge>
                  )}
                  {bonus && (
                    <Badge tone="warn" state="Relacionada a bônus" className="px-1.5 py-px">
                      Bônus
                    </Badge>
                  )}
                  {expiry && (
                    <span className="text-[11px] text-text2">{expiry}</span>
                  )}
                </p>
              )}
            </div>
            <span className="shrink-0 self-center">{historyBadge(h)}</span>
            <span className="w-28 shrink-0 self-center text-right text-[11px] text-text2">
              {when ? (
                <time dateTime={when}>{formatDateTimeInTZ(when)}</time>
              ) : (
                "Vigente"
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Galeria compacta: grade densa, thumbs pequenos, upload em linha única. */
function GalleryManager({
  product,
  canManage,
  onChanged,
}: {
  product: ProductView;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { notify, notifyError } = useToast();

  async function handleFiles(files: FileList | null) {
    if (!files || busy) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (fileRef.current) fileRef.current.value = "";
    if (picked.length === 0) {
      const msg = "Selecione ao menos uma imagem (image/*, até 5 MB cada).";
      setError(msg);
      notify("warn", "Nenhuma imagem válida", msg);
      return;
    }
    setBusy("upload");
    setError(null);
    setNotice(null);
    let done = 0;
    for (const file of picked) {
      if (file.size > 5 * 1024 * 1024) {
        const msg = `"${file.name}" excede 5 MB e foi ignorada.`;
        setError(msg);
        notify("warn", "Imagem ignorada", msg);
        continue;
      }
      try {
        await uploadProductImage(product.code, file);
        done += 1;
      } catch (err) {
        setError(notifyError(err, `Falha ao enviar "${file.name}".`).body);
      }
    }
    setBusy(null);
    if (done > 0) {
      setNotice(`${done} ${done === 1 ? "imagem enviada" : "imagens enviadas"} p/ a VPS.`);
      onChanged();
    }
  }

  async function handleDelete(img: ProductImage) {
    setBusy(img.id);
    setError(null);
    try {
      await deleteProductImage(product.code, img.id);
      setConfirmId(null);
      setNotice(`Imagem "${img.name}" removida (linha + bytes).`);
      onChanged();
    } catch (err) {
      setError(notifyError(err, "Falha ao remover a imagem.").body);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="m-0 text-callout text-text2" role="status">
          {product.gallery.length === 0
            ? "Sem imagens — alimenta carrosséis externos via API."
            : `${product.gallery.length} ${product.gallery.length === 1 ? "imagem" : "imagens"} · via API.`}
        </p>
        {canManage && (
          <span className="ml-auto inline-flex">
            <label
              htmlFor={`galeria-${product.code}`}
              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-base border border-line2 bg-bg2 px-3 text-callout font-semibold text-text1 hover:border-line3 focus-ring"
            >
              <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
              Adicionar
            </label>
            <input
              ref={fileRef}
              id={`galeria-${product.code}`}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </span>
        )}
      </div>
      {notice && (
        <p className="mt-0 flex items-center gap-1.5 text-callout text-text1" role="status">
          <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {notice}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]">
          <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      )}
      {product.gallery.length > 0 && (
        <ul className="m-0 grid grid-cols-4 gap-1.5 p-0 list-none">
          {product.gallery.map((g) => (
            <li key={g.id} className="overflow-hidden rounded-base border border-line1 bg-bg2">
              {g.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.previewUrl} alt={g.name} className="h-14 w-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-14 items-center justify-center px-1 text-center text-callout text-text2">
                  {g.name}
                </span>
              )}
              <span className="flex items-center gap-1 px-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-[11px] text-text2" title={g.name}>
                  {g.name}
                </span>
                {canManage && !g.sessao && (
                  confirmId === g.id ? (
                    <span className="inline-flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        loading={busy === g.id}
                        loadingLabel="Removendo…"
                        disabled={busy !== null}
                        title="Confirmar remoção (linha + bytes)"
                        onClick={() => handleDelete(g)}
                      >
                        OK
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null}
                        title="Voltar sem remover"
                        onClick={() => setConfirmId(null)}
                      >
                        Não
                      </Button>
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      title={busy ? "Aguarde…" : `Remover imagem ${g.name}`}
                      onClick={() => setConfirmId(g.id)}
                    >
                      Remover
                    </Button>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mb-0 mt-1.5 text-callout text-text2">image/* até 5 MB cada; bytes na VPS.</p>
    </div>
  );
}

type TrialKey = {
  licenseId: string;
  key: string;
  keyMasked: string;
  expiresAt: string | null;
};

const PRESETS = [
  { v: "6", label: "6h" },
  { v: "24", label: "24h" },
  { v: "72", label: "3d" },
  { v: "168", label: "7d" },
  { v: "720", label: "30d" },
  { v: "custom", label: "Outro" },
  { v: "infinite", label: "∞ Vitalícia" },
] as const;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Aba Promo: gera chaves promocionais/demo do produto sem sair do modal.
 * Produto já vem fixo (sem seletor); herda as máquinas do produto.
 * Chave em plaintext aparece uma única vez — copie na hora.
 */
function PromoTab({ product }: { product: ProductView }) {
  const canManage = useCan("product.manage");
  const { notify, notifyError } = useToast();
  const [preset, setPreset] = useState<string>("24");
  const [customHours, setCustomHours] = useState("48");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [items, setItems] = useState<TrialKey[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const qtyNum = Number(qty);
  const hoursNum = Number(customHours);
  const qtyOk = Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 100;
  const hoursOk = preset !== "custom" || (Number.isInteger(hoursNum) && hoursNum >= 1 && hoursNum <= 8760);
  const valid = qtyOk && hoursOk;

  async function handleCopy(it: TrialKey) {
    const ok = await copyText(it.key);
    if (ok) {
      setCopiedId(it.licenseId);
      notify("success", "Chave copiada", it.keyMasked);
      window.setTimeout(() => setCopiedId((c) => (c === it.licenseId ? null : c)), 2000);
    } else {
      notify("warn", "Não foi possível copiar", "Selecione a chave manualmente (Ctrl+C).");
    }
  }

  async function handleGenerate() {
    if (!valid || busy || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      const infinite = preset === "infinite";
      const data = await apiPost<{ batchId?: string; kind?: string; items?: TrialKey[] }>(
        "/api/licenses/trial-issue",
        {
          productId: product.code,
          qty: qtyNum,
          maxDevices: product.machinesAllowed,
          ...(infinite ? { infinite: true } : { expiresInHours: preset === "custom" ? hoursNum : Number(preset) }),
          ...(note.trim() ? { note: note.trim(), ownerLabel: note.trim() } : {}),
        },
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      setBatchId(typeof data.batchId === "string" ? data.batchId : null);
      setKind(typeof data.kind === "string" ? data.kind : null);
      setItems(Array.isArray(data.items) ? data.items : []);
      setCopiedId(null);
      notify("success", "Lote promocional gerado", `${data.items?.length ?? 0} chave(s) · copie agora, depois só máscara.`);
    } catch (err) {
      setError(notifyError(err, "Falha ao gerar lote promocional.").body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5 rounded-base border border-line1 bg-bg2 px-2.5 py-2">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accentsoft text-accent"
        >
          <Ticket size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-callout font-semibold text-text1">{product.name}</p>
          <p className="m-0 truncate font-mono tnum text-[0.85em] text-text2">
            {product.code} · {product.machinesAllowed} {product.machinesAllowed === 1 ? "máquina" : "máquinas"}/chave
          </p>
        </div>
        <Badge tone="info" state="Sem conta">Sem conta</Badge>
      </div>
      <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-wide text-text2" id="promo-validade">
        Validade da chave
      </p>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-labelledby="promo-validade">
        {PRESETS.map((p) => {
          const active = preset === p.v;
          return (
            <button
              key={p.v}
              type="button"
              aria-pressed={active}
              onClick={() => setPreset(p.v)}
              disabled={busy}
              className={
                active
                  ? "min-h-[36px] rounded-base border border-accent bg-accentsoft px-3 text-callout font-semibold text-text1 focus-ring"
                  : "min-h-[36px] rounded-base border border-line2 bg-bg2 px-3 text-callout text-text2 hover:border-line3 hover:text-text1 focus-ring disabled:opacity-45"
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-wide text-text2" id="promo-lote">
        Lote
      </p>
      <div className={preset === "custom" ? "mb-3 grid grid-cols-[5.5rem_5.5rem_1fr] gap-2" : "mb-3 grid grid-cols-[5.5rem_1fr] gap-2"} role="group" aria-labelledby="promo-lote">
        {preset === "custom" && (
          <Field label="Horas · 1–8760" htmlFor="promo-horas">
            <Input
              id="promo-horas"
              mono
              inputMode="numeric"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              disabled={busy}
              aria-invalid={!hoursOk}
            />
          </Field>
        )}
        <Field label="Qtd · 1–100" htmlFor="promo-qtd">
          <Input
            id="promo-qtd"
            mono
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            disabled={busy}
            aria-invalid={!qtyOk}
          />
        </Field>
        <Field label="Rótulo · opcional" htmlFor="promo-nota">
          <Input
            id="promo-nota"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="stand feira, parceiro X"
            disabled={busy}
            autoComplete="off"
          />
        </Field>
      </div>
      {preset === "custom" && !hoursOk && (
        <p className="mt-0 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
          Horas inválidas — inteiro entre 1 e 8760.
        </p>
      )}
      {!qtyOk && (
        <p className="mt-0 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
          Quantidade inválida — inteiro entre 1 e 100.
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]">
          <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleGenerate}
          loading={busy}
          loadingLabel="Gerando…"
          disabled={!canManage || !valid || busy}
          title={
            busy
              ? "Gerando…"
              : !canManage
                ? "Requer permissão product.manage"
                : !valid
                  ? "Ajuste validade e quantidade"
                  : `Gerar chaves demo de ${product.name}`
          }
        >
          <Ticket size={14} strokeWidth={1.75} aria-hidden="true" />
          {busy ? "Gerando…" : "Gerar chaves"}
        </Button>
        <p className="m-0 text-callout text-text2">Ativação direta no programa, sem cadastro.</p>
      </div>
      {items.length > 0 && (
        <div className="mt-2 rounded-base border border-line1 bg-bg2 px-2.5 py-2" role="status">
          <p className="m-0 mb-1.5 text-callout text-text1">
            <Badge tone="ok" state="Lote gerado">Lote {batchId}</Badge> {kind} · copie agora, depois só máscara.
          </p>
          <ul className="m-0 grid gap-1 p-0 list-none">
            {items.map((it) => (
              <li key={it.licenseId} className="flex items-center gap-1.5 rounded-base bg-bg1 px-2 py-1">
                <code className="min-w-0 flex-1 truncate font-mono tnum text-[0.85em] text-text1" title={it.key}>
                  {it.key}
                </code>
                <span className="hidden shrink-0 text-[11px] text-text2 sm:inline">
                  expira {it.expiresAt ? formatDateTimeInTZ(it.expiresAt) : "nunca"}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleCopy(it)}
                  title={copiedId === it.licenseId ? "Copiada!" : `Copiar chave ${it.keyMasked}`}
                  aria-label={copiedId === it.licenseId ? "Chave copiada" : `Copiar chave ${it.keyMasked}`}
                >
                  {copiedId === it.licenseId ? (
                    <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Dossiê compacto do produto (tamanho `md`, `glass`, layout fixo).
 * Densidade editorial: identidade fina, estatísticas mini, planos e histórico
 * em linhas (sem tabelas pesadas), galeria 4-col e aba Promo p/ chaves demo.
 */
export function ProductDetailModal({
  productCode,
  initial,
  onClose,
  onChanged,
}: {
  productCode: string;
  /** Linha já conhecida (stale-while-revalidate; cobre criados em sessão). */
  initial?: ProductView | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const canManage = useCan("product.manage");
  const [tab, setTab] = useState<TabId>("overview");
  const [product, setProduct] = useState<ProductView | null>(initial ?? null);
  const [history, setHistory] = useState<LicenseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(initial ? false : true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [changePricePlan, setChangePricePlan] = useState<PlanView | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!initial) setLoading(true);
    Promise.resolve()
      .then(() => getProduct(productCode))
      .then((p) => {
        if (!cancelled) {
          setProduct(p);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        if (!initial) {
          const msg = err instanceof Error ? err.message : "Falha ao carregar produto.";
          setError(/404|não encontrado|not found/i.test(msg) ? "Produto não encontrado." : msg);
        }
      });
    Promise.resolve()
      // `scope:"product"`: diz ao BFF que o ref é product code, então ele vai
      // direto ao fan-out das licenças em vez de sondar o ref como licenseId e
      // depender de um 404 do upstream para se corrigir (ida-e-volta inútil +
      // log de erro falso em toda abertura do modal).
      .then(() => listLicenseHistory(productCode, { scope: "product" }))
      .then((res) => {
        if (!cancelled) setHistory(Array.isArray(res) ? res : res.data);
      })
      .catch(() => {
        // Histórico é acessório — o detalhe abre mesmo sem ele.
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productCode, reloadNonce]);

  function refresh() {
    setReloadNonce((n) => n + 1);
    onChanged?.();
  }

  if (loading) {
    return (
      <Dialog open onClose={onClose} title="Detalhe do produto" size="md" material="glass" initialFocus="close">
        <SkeletonTable rows={4} label="Carregando produto" />
      </Dialog>
    );
  }

  if (!product) {
    return (
      <Dialog open onClose={onClose} title="Detalhe do produto" size="md" material="glass" initialFocus="close">
        <ErrorState message={error ?? "Produto não encontrado."} />
      </Dialog>
    );
  }

  const archived = product.status === "ARCHIVED";
  const planRows = product.plans as PlanRow[];
  const vigentes = planRows.filter((p) => !isSubstituted(p));
  const historico = planRows.filter((p) => isSubstituted(p) || p.validTo);
  const from = minPrice(planRows);
  const metaLine = `${product.slug} · ${product.machinesAllowed} ${product.machinesAllowed === 1 ? "máquina" : "máquinas"} · ${vigentes.length} ${vigentes.length === 1 ? "plano vigente" : "planos vigentes"}${from !== null ? ` · desde ${formatBRL(from / 100)}` : ""}`;

  const TABS: Array<{ id: TabId; label: string }> = [
    { id: "overview", label: "Visão geral" },
    { id: "plans", label: planRows.length > 0 ? `Planos (${vigentes.length})` : "Planos" },
    { id: "licenses", label: "Licenças" },
    { id: "history", label: history.length > 0 ? `Histórico (${history.length})` : "Histórico" },
    { id: "gallery", label: product.gallery.length > 0 ? `Galeria (${product.gallery.length})` : "Galeria" },
    { id: "promo", label: "Promo" },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Produto — ${product.name}`}
      size="md"
      material="glass"
      initialFocus="close"
      fixedContent={
        <>
          <div className="mb-1.5 flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accentsoft text-accent"
            >
              <Box size={16} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-callout font-semibold text-text1">{product.name}</p>
              <p className="m-0 truncate font-mono tnum text-[0.85em] text-text2">{product.code}</p>
            </div>
            <span className="shrink-0">
              <ProductStatusBadge status={product.status} />
            </span>
          </div>
          <p className="m-0 mb-1.5 truncate text-callout text-text2" title={metaLine}>
            {metaLine}
          </p>
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Seções do produto" />
        </>
      }
      footer={
        <Button type="button" variant="secondary" size="sm" onClick={onClose} title="Fechar detalhe do produto">
          Fechar
        </Button>
      }
    >
      {notice && (
        <div className="mb-2 flex items-center gap-1.5 rounded-base border border-line1 bg-bg2 px-2.5 py-1.5" role="status">
          <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-accent" />
          <p className="m-0 text-callout text-text1">{notice}</p>
        </div>
      )}

      {tab === "overview" && (
        <TabPanel label="Visão geral do produto">
          <p className="mt-0 mb-2 text-callout text-text1">
            {product.description?.trim() ? product.description : (
              <span className="text-text2">Sem descrição cadastrada.</span>
            )}
          </p>
          <dl className="m-0 mb-2 grid grid-cols-2 gap-1.5">
            <MiniStat
              icon={<Cpu size={12} strokeWidth={1.75} aria-hidden="true" />}
              label="Máquinas"
              value={`${product.machinesAllowed} por licença`}
            />
            <MiniStat
              icon={<Wallet size={12} strokeWidth={1.75} aria-hidden="true" />}
              label="A partir de"
              value={from !== null ? formatBRL(from / 100) : "—"}
              title={from !== null ? `${vigentes.length} ${vigentes.length === 1 ? "plano vigente" : "planos vigentes"}` : "Sem planos vigentes"}
            />
            <MiniStat
              icon={<Calendar size={12} strokeWidth={1.75} aria-hidden="true" />}
              label="Criado em"
              value={formatDateInTZ(product.createdAt)}
              title={product.slug}
            />
            <MiniStat
              icon={<Archive size={12} strokeWidth={1.75} aria-hidden="true" />}
              label="Catálogo"
              value={archived ? "Arquivado" : planRows.length > 0 ? `${planRows.length} ${planRows.length === 1 ? "linha" : "linhas"}` : "Sem linhas"}
              title={historico.length > 0 ? `${historico.length} no histórico` : "Preço imutável por linha"}
            />
          </dl>
          <section
            aria-label="Plataformas e entrega"
            className="mb-2 rounded-base border border-line1 bg-bg2 px-2.5 py-2"
          >
            <p className="m-0 mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-text2">
              <span aria-hidden="true" className="inline-flex">
                <MonitorSmartphone size={12} strokeWidth={1.75} />
              </span>
              Plataformas
              <span className="font-normal normal-case tracking-normal text-text2">
                · {deliveryModeLabel(product.deliveryMode ?? "OFFLINE")}
              </span>
              <span className="ml-auto">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                  disabled={!canManage || archived}
                  title={
                    archived
                      ? "Produto arquivado não é editável"
                      : canManage
                        ? "Editar nome, slug, descrição, máquinas, plataformas e entrega"
                        : "Requer permissão product.manage"
                  }
                >
                  <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
                  Editar
                </Button>
              </span>
            </p>
            <PlatformIcons ids={product.platforms ?? []} />
          </section>
          <div className="mb-2">
            <ActiveClientsInline productCode={product.code} />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-base border border-line1 bg-bg1 px-2.5 py-1.5">
            <p className="m-0 min-w-0 flex-1 text-callout text-text2">
              Licenças nascem na compra — sem emissão manual aqui.
            </p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setArchiveOpen(true)}
              disabled={!canManage || archived}
              title={
                archived
                  ? "Produto já arquivado"
                  : canManage
                    ? "Arquivar produto (sai do catálogo)"
                    : "Requer permissão product.manage"
              }
            >
              <Ban size={14} strokeWidth={1.75} aria-hidden="true" />
              {archived ? "Arquivado" : "Arquivar"}
            </Button>
          </div>
          <div className="mt-2">
            <TechDetails product={product} />
          </div>
        </TabPanel>
      )}

      {tab === "plans" && (
        <TabPanel label="Planos e preços do produto">
          {planRows.length === 0 ? (
            <EmptyState title="Sem planos" message="Este produto ainda não possui planos de preço." />
          ) : (
            <>
              <p className="mt-0 mb-1.5 text-callout text-text2">
                {vigentes.length} {vigentes.length === 1 ? "vigente" : "vigentes"}
                {from !== null ? (
                  <>
                    {" "}· desde <span className="font-mono tnum text-[0.85em] text-text1">{formatBRL(from / 100)}</span>
                  </>
                ) : null}
                {" "}· congelado em contratos fechados.
              </p>
              {vigentes.length === 0 ? (
                <EmptyState title="Sem planos vigentes" message="Todos os planos deste produto foram substituídos." />
              ) : (
                <PlanRows plans={vigentes} canManage={canManage} archived={archived} onChangePrice={setChangePricePlan} />
              )}
              {historico.length > 0 && (
                <details className="mt-1.5 rounded-base border border-line1 bg-bg1 px-2.5 py-1.5">
                  <summary className="cursor-pointer text-callout font-semibold text-text1 focus-ring">
                    Histórico de preços ({historico.length})
                  </summary>
                  <div className="mt-1.5">
                    <PriceHistoryRows plans={historico} />
                  </div>
                </details>
              )}
            </>
          )}
        </TabPanel>
      )}

      {tab === "licenses" && (
        <TabPanel label="Estado atual das licenças do produto">
          <ProductLicensesPanel productCode={product.code} onChanged={refresh} />
        </TabPanel>
      )}

      {tab === "history" && (
        <TabPanel label="Trilha de histórico das licenças do produto">
          <p className="mt-0 mb-1.5 text-callout text-text2">
            Trilha de auditoria (append-only) — a troca nunca apaga o vínculo anterior. Para o estado
            atual das chaves, veja a aba <strong className="text-text1">Licenças</strong>.
          </p>
          {history.length === 0 ? (
            <EmptyState title="Sem histórico" message="Nenhuma licença emitida para este produto." />
          ) : (
            <LicenseRows history={history} />
          )}
        </TabPanel>
      )}

      {tab === "gallery" && (
        <TabPanel label="Galeria do produto">
          <GalleryManager product={product} canManage={canManage} onChanged={refresh} />
        </TabPanel>
      )}

      {tab === "promo" && (
        <TabPanel label="Chaves promocionais do produto">
          <PromoTab product={product} />
        </TabPanel>
      )}

      {error && (
        <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
          <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      )}

      {changePricePlan && (
        <ChangePriceDialog
          productCode={product.code}
          plan={changePricePlan}
          onClose={() => setChangePricePlan(null)}
          onDone={() => refresh()}
        />
      )}
      {archiveOpen && (
        <ArchiveDialog
          productCode={product.code}
          productName={product.name}
          onClose={() => setArchiveOpen(false)}
          onDone={(auditId) => {
            setNotice(`Produto arquivado · trilha ${auditId}.`);
            refresh();
            onClose();
          }}
        />
      )}
      {editOpen && (
        <EditProductDialog
          product={product}
          onClose={() => setEditOpen(false)}
          onSaved={(saved, mode) => {
            // O BFF devolve o produto completo já normalizado → a visão é
            // atualizada no lugar (sem refazer fetch do modal e sem recarregar
            // a página). `onChanged` só avisa a LISTA por trás.
            setProduct(saved);
            if (mode === "stub") {
              setNotice(
                "API_INTERNAL_URL ausente — alteração só na memória desta sessão (dados sintéticos).",
              );
            }
            onChanged?.();
          }}
        />
      )}
    </Dialog>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Ban,
  Box,
  CircleCheck,
  CircleX,
  Info,
  Pencil,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Table, Td, Th, EmptyState } from "@/components/ui/table";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { ErrorState } from "@/components/feedback/ErrorState";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useCan } from "@/lib/auth/permissions";
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

type TabId = "overview" | "plans" | "history" | "gallery";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Visão geral" },
  { id: "plans", label: "Planos e preços" },
  { id: "history", label: "Licenças e histórico" },
  { id: "gallery", label: "Galeria" },
];

/** Badge de estado do produto (ícone + texto, nunca só cor — DS §9). */
export function ProductStatusBadge({ status }: { status: ProductView["status"] }) {
  if (status === "ACTIVE") {
    return (
      <Badge tone="ok" state="Ativo">
        <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
        Ativo
      </Badge>
    );
  }
  if (status === "DRAFT") {
    return (
      <Badge tone="warn" state="Rascunho">
        <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
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

function historyBadge(status: LicenseHistoryEntry["status"]) {
  const s = String(status).toLowerCase();
  if (s === "active" || s === "ativa") {
    return (
      <Badge tone="ok" state="Ativa">
        <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
        Ativa
      </Badge>
    );
  }
  if (s === "revoked" || s === "revogada") {
    return (
      <Badge tone="danger" state="Revogada">
        <CircleX size={14} strokeWidth={1.75} aria-hidden="true" />
        Revogada
      </Badge>
    );
  }
  if (s === "replaced" || s === "substituida" || s === "substituída") {
    return (
      <Badge tone="info" state="Substituída">
        <Info size={14} strokeWidth={1.75} aria-hidden="true" />
        Substituída
      </Badge>
    );
  }
  if (s === "expired" || s === "expirada") {
    return (
      <Badge tone="neutral" state="Expirada" icon={Archive}>
        Expirada
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" state={String(status)}>
      {String(status)}
    </Badge>
  );
}

/** Linha de plano com versionamento de preço (`status`/`validFrom`/`validTo`/`supersededBy`). */
type PlanRow = PlanView;

function isSubstituted(p: PlanRow): boolean {
  return p.status === "SUBSTITUIDO";
}

/** Badge de estado da linha de preço (ícone + texto, nunca só cor — DS §9). */
function planPriceBadge(p: PlanRow) {
  if (isSubstituted(p)) {
    return (
      <Badge tone="neutral" state="Substituído" icon={Archive}>
        Substituído
      </Badge>
    );
  }
  return (
    <Badge tone="ok" state="Ativo">
      <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
      Ativo
    </Badge>
  );
}

function formatValidity(p: PlanRow): string {
  const from = formatDateInTZ(p.validFrom);
  const to = p.validTo ? formatDateInTZ(p.validTo) : "vigente";
  return `${from} – ${to}`;
}

type ActiveClientRow = ProductActiveClient;

/** Card "Clientes com licenças ativas" da aba Visão geral. */
function ActiveClientsCard({ productCode }: { productCode: string }) {
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
      <section
        aria-label="Clientes com licenças ativas"
        className="mt-4 rounded-card border border-line1 bg-bg1 shadow-1 p-5"
      >
        <h3 className="mt-0 text-headline text-text1">Clientes com licenças ativas</h3>
        <SkeletonTable rows={3} label="Carregando clientes ativos" />
      </section>
    );
  }

  if (error) {
    return (
      <section
        aria-label="Clientes com licenças ativas"
        className="mt-4 rounded-card border border-line1 bg-bg1 shadow-1 p-5"
      >
        <h3 className="mt-0 text-headline text-text1">Clientes com licenças ativas</h3>
        <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
      </section>
    );
  }

  const list = rows ?? [];
  if (list.length === 0) {
    return (
      <section
        aria-label="Clientes com licenças ativas"
        className="mt-4 rounded-card border border-line1 bg-bg1 shadow-1 p-5"
      >
        <h3 className="mt-0 text-headline text-text1">Clientes com licenças ativas</h3>
        <EmptyState title="Sem clientes ativos neste produto" message="Nenhum cliente com licenças ativas ou em graça neste produto." />
      </section>
    );
  }

  const totalActive = list.reduce((acc, r) => acc + r.active, 0);
  const totalGrace = list.reduce((acc, r) => acc + r.grace, 0);
  const summary =
    `${list.length} ${list.length === 1 ? "cliente" : "clientes"} · ` +
    `${totalActive} ${totalActive === 1 ? "ativa" : "ativas"} · ` +
    `${totalGrace} em graça`;

  return (
    <section
      aria-label="Clientes com licenças ativas"
      className="mt-4 rounded-card border border-line1 bg-bg1 shadow-1 p-5"
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="m-0 text-headline text-text1">Clientes com licenças ativas</h3>
        <Badge tone="accent" state={summary}>
          {summary}
        </Badge>
      </div>
      <Table
        caption="Clientes com licenças ativas neste produto"
        head={
          <>
            <Th>Cliente</Th>
            <Th numeric>Ativas</Th>
            <Th numeric>Em graça</Th>
          </>
        }
      >
        {list.map((r) => (
          <tr key={r.customerId}>
            <Td>{r.customerName}</Td>
            <Td numeric>{r.active}</Td>
            <Td numeric>{r.grace}</Td>
          </tr>
        ))}
      </Table>
    </section>
  );
}

/** Galeria do produto: adicionar (upload p/ a VPS) e remover (linha + bytes). */
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

  async function handleFiles(files: FileList | null) {
    if (!files || busy) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (fileRef.current) fileRef.current.value = "";
    if (picked.length === 0) {
      setError("Selecione ao menos uma imagem (image/*, até 5 MB cada).");
      return;
    }
    setBusy("upload");
    setError(null);
    setNotice(null);
    let done = 0;
    for (const file of picked) {
      if (file.size > 5 * 1024 * 1024) {
        setError(`"${file.name}" excede 5 MB e foi ignorada.`);
        continue;
      }
      try {
        await uploadProductImage(product.code, file);
        done += 1;
      } catch (err) {
        setError(err instanceof Error ? err.message : `Falha ao enviar "${file.name}".`);
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
      setError(err instanceof Error ? err.message : "Falha ao remover a imagem.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="mt-0 text-callout text-text2" role="status">
        {product.gallery.length === 0
          ? "Sem imagens"
          : `${product.gallery.length} ${product.gallery.length === 1 ? "imagem" : "imagens"}`}
        {" "}— alimenta carrosséis externos via API (sem carrossel no admin).
      </p>
      {canManage && (
        <div className="mb-3">
          <label
            htmlFor={`galeria-${product.code}`}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-base border border-line2 bg-bg2 px-4 text-body text-text1 hover:border-line3 focus-ring"
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            Adicionar imagens
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
          <p className="mt-1 text-callout text-text2">image/* até 5 MB cada; bytes na VPS.</p>
        </div>
      )}
      {notice && (
        <p className="text-body text-text1" role="status">
          <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" className="mr-1 inline" />
          {notice}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      )}
      {product.gallery.length > 0 && (
        <ul className="m-0 grid grid-cols-2 gap-2 p-0 list-none sm:grid-cols-3">
          {product.gallery.map((g) => (
            <li key={g.id} className="rounded-base border border-line1 bg-bg2 p-1">
              {g.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.previewUrl} alt={g.name} className="h-20 w-full rounded-base object-cover" loading="lazy" />
              ) : (
                <span className="flex h-20 items-center justify-center text-callout text-text2">{g.name}</span>
              )}
              <span className="block truncate px-1 pt-1 text-caption text-text2" title={g.name}>
                {g.name}
                {!g.sessao && <span className="text-text2"> · VPS</span>}
              </span>
              {canManage && !g.sessao && (
                <span className="flex gap-2 px-1 pb-1">
                  {confirmId === g.id ? (
                    <>
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
                        Confirmar
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null}
                        title="Voltar sem remover"
                        onClick={() => setConfirmId(null)}
                      >
                        Voltar
                      </Button>
                    </>
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
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Detalhe do produto em modal (tamanho `lg`, material `glass` E3 — mesma
 * exceção do detalhe do cliente). Única visualização de detalhe (sem página).
 * Licenças nascem na efetividade da compra (fluxo de billing/cliente) — esta
 * tela só altera preço (por plano vigente) e arquiva, com gate
 * `product.manage`; leitura aberta como o catálogo.
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
      .then(() => listLicenseHistory(productCode))
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
      <Dialog open onClose={onClose} title="Detalhe do produto" size="lg" material="glass" initialFocus="close">
        <SkeletonTable rows={5} label="Carregando produto" />
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

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Produto — ${product.name}`}
      size="lg"
      material="glass"
      footer={
        <Button type="button" variant="secondary" onClick={onClose} title="Fechar detalhe do produto">
          Fechar
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accentsoft text-accent"
        >
          <Box size={20} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-headline font-semibold text-text1">{product.name}</p>
          <p className="m-0 truncate font-mono tnum text-[0.85em] text-text2">{product.code}</p>
        </div>
        <span className="ml-auto shrink-0">
          <ProductStatusBadge status={product.status} />
        </span>
      </div>

      {notice && (
        <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
          <p className="m-0 text-body text-text1">{notice}</p>
        </div>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Seções do produto" />
      <div className="mt-4">
        {tab === "overview" && (
          <TabPanel label="Visão geral do produto">
            <section aria-label="Informações do produto" className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
              <dl className="m-0 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-callout text-text2">Descrição</dt>
                  <dd className="m-0 text-body text-text1">{product.description || "—"}</dd>
                </div>
                <div>
                  <dt className="text-callout text-text2">Máquinas simultâneas</dt>
                  <dd className="m-0 text-body text-text1">
                    <span className="font-mono tnum text-[0.85em]">{product.machinesAllowed}</span> por licença
                  </dd>
                </div>
                <div>
                  <dt className="text-callout text-text2">Criado em</dt>
                  <dd className="m-0 text-body text-text1">
                    <time dateTime={product.createdAt}>{formatDateInTZ(product.createdAt)}</time>
                  </dd>
                </div>
                <div>
                  <dt className="text-callout text-text2">Slug</dt>
                  <dd className="m-0 text-body text-text1">
                    <span className="font-mono tnum text-[0.85em]">{product.slug}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-callout text-text2">Código</dt>
                  <dd className="m-0 text-body text-text1">
                    <span className="font-mono tnum text-[0.85em]">{product.code}</span>
                  </dd>
                </div>
              </dl>
            </section>
            <ActiveClientsCard productCode={product.code} />
            <section aria-label="Ações do produto" className="mt-4 rounded-card border border-line1 bg-bg1 shadow-1 p-5">
              <h3 className="mt-0 text-headline text-text1">Ações</h3>
              <p className="mt-0 text-callout text-text2">
                Licenças nascem na efetividade da compra, no fluxo de billing/cliente —
                sem emissão manual nesta tela.
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Ações do produto">
                <Button
                  type="button"
                  variant="destructive"
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
                  <Ban size={16} strokeWidth={1.75} aria-hidden="true" />
                  Arquivar
                </Button>
              </div>
            </section>
          </TabPanel>
        )}

        {tab === "plans" && (
          <TabPanel label="Planos e preços do produto">
            {product.plans.length === 0 ? (
              <EmptyState title="Sem planos" message="Este produto ainda não possui planos de preço." />
            ) : (
              <>
                <Table
                  caption={`Planos vigentes de ${product.name} (ciclo e valor)`}
                  head={
                    <>
                      <Th>Plano</Th>
                      <Th>Ciclo</Th>
                      <Th numeric>Valor</Th>
                      <Th>Estado</Th>
                      <Th>Ação</Th>
                    </>
                  }
                >
                  {vigentes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-3 text-text1">Sem planos vigentes.</td>
                    </tr>
                  ) : (
                    vigentes.map((p) => (
                      <tr key={p.id}>
                        <Td>{p.name}</Td>
                        <Td>
                          {p.billingInterval === "MONTH" ? (
                            <Badge tone="accent" state="Pacote mensal">Mensal</Badge>
                          ) : (
                            <Badge tone="info" state="Pacote anual">Anual</Badge>
                          )}
                        </Td>
                        <Td numeric>{formatBRL(p.priceCents / 100)}</Td>
                        <Td>
                          {planPriceBadge(p)}
                        </Td>
                        <Td>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setChangePricePlan(p)}
                            disabled={!canManage || archived}
                            title={
                              archived
                                ? "Produto arquivado"
                                : canManage
                                  ? `Alterar preço do plano ${p.name}`
                                  : "Requer permissão product.manage"
                            }
                          >
                            Alterar preço
                          </Button>
                        </Td>
                      </tr>
                    ))
                  )}
                </Table>
                <section aria-label="Histórico de preços" className="mt-4">
                  <h3 className="mt-0 text-headline text-text1">Histórico</h3>
                  {historico.length === 0 ? (
                    <EmptyState
                      title="Sem histórico de preços"
                      message="Nenhuma alteração de preço registrada — contratos mantêm o valor original."
                    />
                  ) : (
                    <Table
                      caption={`Histórico de preços de ${product.name} (linhas substituídas)`}
                      head={
                        <>
                          <Th numeric>Valor</Th>
                          <Th>Vigência de–até</Th>
                          <Th>Estado</Th>
                        </>
                      }
                    >
                      {historico.map((p) => (
                        <tr key={p.id}>
                          <Td numeric>{formatBRL(p.priceCents / 100)}</Td>
                          <Td>{formatValidity(p)}</Td>
                          <Td>{planPriceBadge(p)}</Td>
                        </tr>
                      ))}
                    </Table>
                  )}
                  <p className="mb-0 text-callout text-text2">
                    Contratos fechados mantêm o preço congelado; só novas cobranças usam o valor vigente.
                  </p>
                </section>
              </>
            )}
          </TabPanel>
        )}

        {tab === "history" && (
          <TabPanel label="Licenças e histórico do produto">
            <p className="mt-0 text-callout text-text2">
              Licenças antigas são preservadas para auditoria — a renovação-com-troca nunca
              apaga o vínculo anterior.
            </p>
            {history.length === 0 ? (
              <EmptyState title="Sem histórico" message="Nenhuma licença emitida para este produto." />
            ) : (
              <Table
                caption={`Histórico de licenças de ${product.name} (preservado p/ auditoria)`}
                head={
                  <>
                    <Th>Licença</Th>
                    <Th>Estado</Th>
                    <Th>Motivo</Th>
                    <Th>Encerrada em</Th>
                    <Th>Substituída por</Th>
                  </>
                }
              >
                {history.map((h) => (
                  <tr key={h.licenseId}>
                    <Td mono>{h.keyMasked}</Td>
                    <Td>{historyBadge(h.status)}</Td>
                    <Td>{h.reason || "—"}</Td>
                    <Td>
                      {h.endedAt ? (
                        <time dateTime={h.endedAt}>{formatDateTimeInTZ(h.endedAt)}</time>
                      ) : (
                        <span className="text-callout text-text2">Ainda vigente</span>
                      )}
                    </Td>
                    <Td mono>{h.replacedBy ?? "—"}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </TabPanel>
        )}

        {tab === "gallery" && (
          <TabPanel label="Galeria do produto">
            <GalleryManager product={product} canManage={canManage} onChanged={refresh} />
          </TabPanel>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
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
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Box, Eye, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useCan } from "@/lib/auth/permissions";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { formatBRL } from "@/lib/format";
import { listProducts } from "@/lib/products";
import type { ProductView } from "@/lib/types";
import { CreateProductDialog } from "@/components/produtos/CreateProductDialog";
import { ProductDetailModal, ProductStatusBadge } from "@/components/produtos/ProductDetailModal";

function plansSummary(p: ProductView): React.ReactNode {
  if (p.plans.length === 0) {
    return <span className="text-callout text-text2">Sem planos</span>;
  }
  const min = Math.min(...p.plans.map((pl) => pl.priceCents));
  return (
    <span>
      {p.plans.length} {p.plans.length === 1 ? "plano" : "planos"} ·{" "}
      <span className="font-mono tnum text-[0.85em]">desde {formatBRL(min / 100)}</span>
    </span>
  );
}

/**
 * Catálogo de produtos com licenças offline. Leitura aberta (como o catálogo);
 * mutações exigem `product.manage` (gates nos diálogos + botão de criação).
 * Detalhe em modal (`ProductDetailModal`) com retorno de foco ao gatilho.
 */
export default function ProdutosPage() {
  const canManage = useCan("product.manage");
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const [nonce, setNonce] = useState(0);
  const [products, setProducts] = useState<ProductView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<ProductView[]>([]);
  const [fresh, setFresh] = useState<ProductView | null>(null);

  // Camada tolerante a sync/async: `Promise.resolve` aceita ambos os moldes.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.resolve()
      .then(() => listProducts(debounced, null))
      .then((res) => {
        if (cancelled) return;
        setProducts(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setProducts([]);
        setError(err instanceof Error ? err.message : "Falha ao carregar produtos.");
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, nonce]);

  // Criados em sessão (stub até a camada listar o backend) entram primeiro.
  const q = debounced.trim().toLowerCase();
  const rows: ProductView[] = [
    ...created.filter((p) => `${p.name} ${p.code} ${p.slug}`.toLowerCase().includes(q)),
    ...(products ?? []),
  ];
  const taken = rows.map((p) => p.code.toLowerCase()).concat(rows.map((p) => p.slug.toLowerCase()));
  const loading = products === null && error === null;
  const selected = selectedCode ? rows.find((p) => p.code === selectedCode) ?? null : null;

  function closeDetail() {
    const code = selectedCode;
    setSelectedCode(null);
    // Retorno de foco ao gatilho (DS §6: foco síncrono, nunca pós-animação).
    if (code) {
      requestAnimationFrame(() => {
        document.getElementById(`produto-${code}`)?.focus();
      });
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-title-page text-text1">Produtos</h1>
        <Button
          type="button"
          variant="primary"
          onClick={() => setCreateOpen(true)}
          disabled={!canManage}
          title={canManage ? "Criar novo produto com licenças offline" : "Requer permissão product.manage"}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Novo produto
        </Button>
      </div>

      {fresh && (
        <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
          <p className="m-0 text-body text-text1">
            <Badge tone="ok" state="Produto criado">Produto criado</Badge> {fresh.name} · código{" "}
            <span className="font-mono tnum text-[0.85em]">{fresh.code}</span>
          </p>
        </div>
      )}

      <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4">
        <div className="max-w-[24rem]">
          <Field label="Buscar por nome, código ou slug" htmlFor="busca-produtos">
            <Input
              id="busca-produtos"
              type="search"
              placeholder="Ex.: Aurum Pro"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
        </div>
        <p className="m-0 text-callout text-text2">
          Selecione um produto para ver planos, licenças, histórico e galeria em modal.
        </p>
      </div>

      {loading ? (
        <SkeletonTable rows={5} label="Carregando produtos" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhum produto encontrado"
          message="Ajuste a busca ou crie um novo produto."
        />
      ) : (
        <Table
          caption="Lista de produtos com licenças offline"
          head={
            <>
              <Th>Produto</Th>
              <Th numeric>Máquinas</Th>
              <Th>Planos</Th>
              <Th>Status</Th>
              <Th>Detalhe</Th>
            </>
          }
        >
          {rows.map((p) => (
            <tr key={p.code}>
              <Td>
                <span className="inline-flex items-center gap-2">
                  <Box size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text2" />
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    <span className="block truncate font-mono tnum text-[0.85em] text-text2">{p.code}</span>
                  </span>
                </span>
              </Td>
              <Td numeric>{p.machinesAllowed}</Td>
              <Td>{plansSummary(p)}</Td>
              <Td>
                <ProductStatusBadge status={p.status} />
              </Td>
              <Td>
                <Button
                  id={`produto-${p.code}`}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedCode(p.code)}
                  title={`Ver detalhes de ${p.name}`}
                  aria-label={`Ver detalhes de ${p.name}`}
                  aria-haspopup="dialog"
                >
                  <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                  Abrir
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {selectedCode && (
        <ProductDetailModal
          productCode={selectedCode}
          initial={selected}
          onClose={closeDetail}
          onChanged={() => setNonce((n) => n + 1)}
        />
      )}
      {createOpen && (
        <CreateProductDialog
          taken={taken}
          onClose={() => setCreateOpen(false)}
          onDone={(product) => {
            setCreated((list) => [product, ...list]);
            setFresh(product);
          }}
        />
      )}
    </div>
  );
}

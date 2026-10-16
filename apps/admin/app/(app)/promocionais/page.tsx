"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { useCan } from "@/lib/auth/permissions";
import { listProducts } from "@/lib/products";
import type { ProductView } from "@/lib/types";

type TrialItem = {
  licenseId: string;
  key: string;
  keyMasked: string;
  expiresAt: string | null;
};

/**
 * Seção Promocionais/Demo: gera chaves sem conta (trial horas/dias ou lifetime).
 * Ativação no programa é só por chave: POST /v1/licenses/activate-by-key.
 */
export default function PromocionaisPage() {
  const canManage = useCan("product.manage");
  const [productId, setProductId] = useState("");
  const [products, setProducts] = useState<ProductView[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [preset, setPreset] = useState("24");
  const [customHours, setCustomHours] = useState("48");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [items, setItems] = useState<TrialItem[]>([]);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingProducts(true);
    setProductsError(null);
    Promise.resolve()
      .then(() => listProducts("", null))
      .then((res) => {
        if (cancelled) return;
        setProducts(res.data ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setProducts([]);
        setProductsError(err instanceof Error ? err.message : "Falha ao carregar produtos.");
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    setRevealed(false);
    try {
      const infinite = preset === "infinite";
      const expiresInHours = infinite
        ? undefined
        : preset === "custom"
          ? Number(customHours)
          : Number(preset);
      const res = await fetch("/api/licenses/trial-issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          productId: productId.trim(),
          qty: Number(qty),
          maxDevices: 1,
          ...(infinite ? { infinite: true } : { expiresInHours }),
          ...(note.trim() ? { note: note.trim(), ownerLabel: note.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.message === "string" ? data.message : "Falha ao gerar lote.");
      setBatchId(typeof data.batchId === "string" ? data.batchId : null);
      setKind(typeof data.kind === "string" ? data.kind : null);
      setItems(Array.isArray(data.items) ? data.items : []);
      setRevealed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao gerar lote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-title-page text-text1">Promocionais / Demo</h1>
        <Badge tone="info" state="Sem conta">Sem conta · só chave</Badge>
      </div>
      <p className="text-body text-text2">
        Chaves de demonstração por tempo limitado (horas/dias) ou infinitas (parcerias).
        O usuário ativa direto no programa via License Key, sem cadastro Aurumbit.
      </p>

      <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4 grid gap-3 max-w-[32rem]">
        <Field
          label="Produto"
          htmlFor="promo-product"
          hint={loadingProducts ? "Carregando produtos..." : undefined}
          error={productsError}
        >
          <Select
            id="promo-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            disabled={loadingProducts || products.length === 0}
            mono
          >
            <option value="">{loadingProducts ? "Carregando..." : "Selecione um produto"}</option>
            {products.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} · {p.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Validade" htmlFor="promo-preset">
          <Select id="promo-preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="6">6 horas</option>
            <option value="24">24 horas</option>
            <option value="72">3 dias (72h)</option>
            <option value="168">7 dias (168h)</option>
            <option value="720">30 dias (720h)</option>
            <option value="custom">Personalizado (horas)</option>
            <option value="infinite">Infinito (parceria lifetime)</option>
          </Select>
        </Field>
        {preset === "custom" && (
          <Field label="Horas (1..8760)" htmlFor="promo-hours">
            <Input id="promo-hours" value={customHours} onChange={(e) => setCustomHours(e.target.value)} inputMode="numeric" />
          </Field>
        )}
        <Field label="Quantidade (1..100)" htmlFor="promo-qty">
          <Input id="promo-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Rótulo do lote (opcional)" htmlFor="promo-note">
          <Input id="promo-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="stand feira, parceiro X" />
        </Field>
        {error && <p role="alert" className="m-0 text-body text-danger">{error}</p>}
        <Button type="button" variant="primary" onClick={generate} disabled={!canManage || busy || !productId.trim()}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          {busy ? "Gerando..." : "Gerar chaves"}
        </Button>
        {!canManage && <p className="m-0 text-callout text-text2">Requer permissão product.manage</p>}
      </div>

      {revealed && items.length > 0 && (
        <div className="rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
          <p className="m-0 text-body text-text1">
            <Badge tone="ok" state="Lote gerado">Lote {batchId}</Badge> {kind} · {items.length} chave(s) ·
            copie agora, depois só máscara.
          </p>
          <ul className="mt-3 grid gap-2 p-0 list-none">
            {items.map((it) => (
              <li key={it.licenseId} className="font-mono tnum text-[0.85em] break-all">
                {it.key} <span className="text-text2">· {it.keyMasked} · expira {it.expiresAt ?? "nunca"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

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

type PromoType = "BONUS" | "DISCOUNT";

/**
 * Seção Promocionais/Demo: gera chaves sem conta (trial horas/dias ou lifetime)
 * ou códigos de desconto vinculados a influenciador (exigem login na compra).
 */
export default function PromocionaisPage() {
  const canManage = useCan("product.manage");
  const [productId, setProductId] = useState("");
  const [products, setProducts] = useState<ProductView[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [promoType, setPromoType] = useState<PromoType>("BONUS");

  // Bonificação (trial)
  const [preset, setPreset] = useState("24");
  const [customHours, setCustomHours] = useState("48");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");

  // Desconto
  const [discountPercent, setDiscountPercent] = useState("30");
  const [commissionPercent, setCommissionPercent] = useState("10");
  const [maxDevices, setMaxDevices] = useState("3");
  const [influencerName, setInfluencerName] = useState("");
  const [influencerPlatformUrl, setInfluencerPlatformUrl] = useState("");
  const [influencerSource, setInfluencerSource] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [items, setItems] = useState<TrialItem[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [partialCode, setPartialCode] = useState<string | null>(null);

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

  async function generateBonus() {
    setBusy(true);
    setError(null);
    setRevealed(false);
    setPartialCode(null);
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

  async function generateDiscount() {
    setBusy(true);
    setError(null);
    setRevealed(false);
    setPartialCode(null);
    try {
      const body = {
        productId: productId.trim(),
        type: "DISCOUNT",
        discountPercent: Number(discountPercent),
        commissionPercent: Number(commissionPercent),
        maxDevices: Number(maxDevices),
        note: note.trim() || null,
        influencerName: influencerName.trim() || null,
        influencerPlatformUrl: influencerPlatformUrl.trim() || null,
        influencerSource: influencerSource.trim() || null,
        expiresInHours: expiresInHours.trim() ? Number(expiresInHours) : null,
      };
      const res = await fetch("/api/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.message === "string" ? data.message : "Falha ao criar promoção.");
      setPartialCode(typeof data.promoCode === "string" ? data.promoCode : null);
      setRevealed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao criar promoção.");
    } finally {
      setBusy(false);
    }
  }

  function generate() {
    if (promoType === "BONUS") void generateBonus();
    else void generateDiscount();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-title-page text-text1">Promocionais</h1>
        <Badge tone="info" state="Promoções">Promoções</Badge>
      </div>
      <p className="text-body text-text2">
        Bonificação: chaves sem conta (trial). Desconto: código vinculado a influenciador, exige login na compra
        e gera comissão no financeiro.
      </p>

      <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4 grid gap-3 max-w-[40rem]">
        <Field label="Tipo" htmlFor="promo-type">
          <Select id="promo-type" value={promoType} onChange={(e) => setPromoType(e.target.value as PromoType)}>
            <option value="BONUS">Bonificação (sem login/cadastro)</option>
            <option value="DISCOUNT">Desconto (exige login)</option>
          </Select>
        </Field>
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

        {promoType === "BONUS" && (
          <>
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
          </>
        )}

        {promoType === "DISCOUNT" && (
          <>
            <Field label="Desconto do produto (%)" htmlFor="promo-discount">
              <Input id="promo-discount" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Comissão do influenciador (%)" htmlFor="promo-commission">
              <Input id="promo-commission" value={commissionPercent} onChange={(e) => setCommissionPercent(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Máquinas por licença" htmlFor="promo-maxdevices">
              <Input id="promo-maxdevices" value={maxDevices} onChange={(e) => setMaxDevices(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Nome do influenciador" htmlFor="promo-inf-name">
              <Input id="promo-inf-name" value={influencerName} onChange={(e) => setInfluencerName(e.target.value)} />
            </Field>
            <Field label="Link da plataforma" htmlFor="promo-inf-url">
              <Input id="promo-inf-url" value={influencerPlatformUrl} onChange={(e) => setInfluencerPlatformUrl(e.target.value)} placeholder="https://..." />
            </Field>
            <Field label="De onde conheceu" htmlFor="promo-inf-source">
              <Input id="promo-inf-source" value={influencerSource} onChange={(e) => setInfluencerSource(e.target.value)} />
            </Field>
            <Field label="Validade (horas, opcional)" htmlFor="promo-exp">
              <Input id="promo-exp" value={expiresInHours} onChange={(e) => setExpiresInHours(e.target.value)} inputMode="numeric" placeholder="vazio = vitalícia" />
            </Field>
          </>
        )}

        <Field label="Rótulo (opcional)" htmlFor="promo-note">
          <Input id="promo-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="stand feira, parceiro X" />
        </Field>
        {error && <p role="alert" className="m-0 text-body text-danger">{error}</p>}
        <Button type="button" variant="primary" onClick={generate} disabled={!canManage || busy || !productId.trim()}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          {busy ? "Gerando..." : promoType === "BONUS" ? "Gerar chaves" : "Criar código de desconto"}
        </Button>
        {!canManage && <p className="m-0 text-callout text-text2">Requer permissão product.manage</p>}
      </div>

      {revealed && promoType === "BONUS" && items.length > 0 && (
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

      {revealed && promoType === "DISCOUNT" && partialCode && (
        <div className="rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
          <p className="m-0 text-body text-text1">
            <Badge tone="ok" state="Código gerado">Código parcial</Badge> {partialCode}
          </p>
          <p className="m-0 mt-2 text-callout text-text2">
            Distribua este código (faltam 4 dígitos). Na compra, o sistema completa a chave e vincula à conta do cliente.
            Desconto: {discountPercent}% · Comissão: {commissionPercent}%.
          </p>
        </div>
      )}
    </div>
  );
}

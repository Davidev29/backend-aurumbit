"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { useToast } from "@/lib/toast";
import { createProduct, getProduct, uploadProductImage } from "@/lib/products";
import type { ProductImage, ProductView } from "@/lib/types";
import {
  deliveryModeLabel,
  normalizePlatformIds,
  platformLabel,
  type ProductDeliveryMode,
  type ProductPlatformId,
} from "@/lib/platforms";
import { DeliveryModeRadio, PlatformPicker } from "./PlatformPicker";
import { cn } from "@/lib/cn";

/** "149,90" / "149.90" → centavos; `null` = vazio ou inválido (ver `empty`). */
function parseBRLCents(raw: string): { empty: boolean; cents: number | null } {
  const t = raw.trim();
  if (t === "") return { empty: true, cents: null };
  // Formatos aceitos: "149,90" e "1.199,90" (BR) + "99.90" (ponto decimal).
  // Só-ponto com 1–2 decimais = decimal; senão o ponto é milhar (legado BR).
  const nospace = t.replace(/\s/g, "");
  const norm = nospace.includes(",")
    ? nospace.replace(/\./g, "").replace(",", ".")
    : /^\d+\.\d{1,2}$/.test(nospace)
      ? nospace
      : nospace.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return { empty: false, cents: null };
  const v = Number(norm);
  if (!Number.isFinite(v) || v <= 0) return { empty: false, cents: null };
  return { empty: false, cents: Math.round(v * 100) };
}

function slugify(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function codeify(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_").slice(0, 60);
}

const MAX_DESC = 500;

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Seleção local com bytes p/ upload real (File) + thumb de sessão (preview). */
interface PendingImage {
  entry: ProductImage;
  file: File | null;
}

/** Indicador compacto de etapa (sem scroll, sem dependência nova). */
function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const items = [
    { n: 1, label: "Básico" },
    { n: 2, label: "Preços e galeria" },
    { n: 3, label: "Plataformas" },
  ] as const;
  return (
    <ol aria-label="Etapas da criação" className="m-0 mb-3 flex flex-wrap items-center gap-2 p-0 list-none">
      {items.map((it, i) => {
        const active = step === it.n;
        const done = step > it.n;
        return (
          <li key={it.n} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            {i > 0 && <span aria-hidden="true" className="h-px w-4 bg-line2" />}
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                active ? "bg-accent text-accentink" : done ? "bg-accentsoft text-accent" : "bg-bg2 text-text2 border border-line2",
              )}
            >
              {it.n}
            </span>
            <span className={cn("text-callout", active ? "font-semibold text-text1" : "text-text2")}>
              {it.label}
            </span>
          </li>
        );
      })}
      <li className="ml-auto text-callout text-text2">Etapa {step} de 3</li>
    </ol>
  );
}

/**
 * Criação de produto em assistente de 3 etapas (Dialog glass md).
 * Resolve o scroll vertical excessivo do molde anterior (8 campos empilhados):
 * etapa 1 só identidade (nome/slug/código/descrição/máquinas),
 * etapa 2 só comercial (preços + galeria + resumo),
 * etapa 3 só entrega (plataformas + modo de entrega). Nenhuma etapa rola em
 * viewport comum — o painel fica compacto e elegante.
 *
 * POR QUE 3 ETAPAS E NÃO UM BLOCO NA ETAPA 1: a invariante do arquivo é
 * "nenhuma etapa rola". O seletor de plataformas (5 tiles de 44px em grade) +
 * o radio de entrega somam ~245px de altura. A etapa 1 já usa ~425px e o
 * painel abre em `pt-[15vh]` com `max-h-[85vh]`: adicionar ali faria a etapa
 * 1 rolarem em qualquer laptop 13" — trocando um scroll por outro. Etapa
 * própria preserva a invariante e dá à escolha o foco que ela merece (o
 * usuário pediu explicitamente por ela).
 */
export function CreateProductDialog({
  taken,
  onClose,
  onDone,
}: {
  /** Códigos/slugs já em uso (lista + sessão), em minúsculas. */
  taken: string[];
  onClose: () => void;
  onDone: (product: ProductView) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [slug, setSlug] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [machinesRaw, setMachinesRaw] = useState("3");
  const [monthlyRaw, setMonthlyRaw] = useState("");
  const [annualRaw, setAnnualRaw] = useState("");
  /** Ordem de clique, não canônica — `platforms` abaixo já normaliza. */
  const [picked, setPicked] = useState<ProductPlatformId[]>([]);
  const [deliveryMode, setDeliveryMode] = useState<ProductDeliveryMode>("OFFLINE");
  /** Só mostra o erro de plataforma depois que o operador tentou sair da etapa. */
  const [platformTouched, setPlatformTouched] = useState(false);
  const [gallery, setGallery] = useState<PendingImage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { notify, notifyError } = useToast();

  const nameValid = name.trim().length >= 3;
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const codeValid = /^[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/.test(code);
  const codeTaken = codeValid && taken.includes(code.trim().toLowerCase());
  const slugTaken = slugValid && taken.includes(slug.trim().toLowerCase());
  const machines = Number(machinesRaw);
  const machinesValid = Number.isInteger(machines) && machines >= 1 && machines <= 100;
  const monthly = parseBRLCents(monthlyRaw);
  const annual = parseBRLCents(annualRaw);
  const monthlyOk = monthly.empty || monthly.cents !== null;
  const annualOk = annual.empty || annual.cents !== null;
  const hasPrice = monthly.cents !== null || annual.cents !== null;
  const descLen = description.trim().length;
  const descValid = descLen <= MAX_DESC;
  /**
   * Plataformas: >= 1 é OBRIGATÓRIO na criação (decisão de negócio, não
   *atinge limitação do banco).
   *
   * O banco tem `platforms TEXT[] NOT NULL DEFAULT '{}'` e o Nest aceita
   * array vazio (`@IsOptional()`, sem `@ArrayMinSize`) — mas `{}` significa
   * "ainda não declarado", um estado aceitável só para produto LEGADO
   * (criado antes desta coluna). Produto novo sem plataforma é falso: não dá
   * p/ a landpage filtrar, nem p/ o cliente entender o que está comprando.
   * Exigir aqui mantém o default do banco intacto para o legado e impede que
   * o operador crie buraco novo. O BFF repete a trava (422) — a UI não é a
   * única linha, porque `POST /api/products` tem outros consumidores
   * possíveis.
   */
  const platforms = normalizePlatformIds(picked);
  const platformsValid = platforms.length > 0;
  const step1Valid = nameValid && slugValid && codeValid && !codeTaken && !slugTaken && machinesValid && descValid;
  const step3Valid = platformsValid;
  const valid = step1Valid && monthlyOk && annualOk && hasPrice && step3Valid;

  function handleNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
    if (!codeTouched) setCode(codeify(slugify(v)));
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const remaining = MAX_IMAGES - gallery.length;
    if (remaining <= 0) {
      setError(`Limite de ${MAX_IMAGES} imagens por produto.`);
      return;
    }
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, remaining);
    for (const file of picked) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" excede 5 MB e foi ignorada.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const previewUrl = typeof reader.result === "string" ? reader.result : "";
        setGallery((g) =>
          g.length >= MAX_IMAGES
            ? g
            : [
                ...g,
                {
                  entry: {
                    id: `sess-${Date.now()}-${g.length}`,
                    name: file.name,
                    size: file.size,
                    previewUrl,
                    sessao: true,
                  },
                  file,
                },
              ],
        );
      };
      reader.readAsDataURL(file);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const product = await createProduct({
        name: name.trim(),
        code: code.trim(),
        slug: slug.trim(),
        description: description.trim(),
        machinesAllowed: machines,
        // Dedup + ordem canônica do catálogo (o backend também normaliza;
        // mandar já normalizado evita a tela mostrar outra ordem do gravado).
        platforms,
        deliveryMode,
        monthlyPriceCents: monthly.cents ?? undefined,
        annualPriceCents: annual.cents ?? undefined,
        // Metadados seguem p/ compat com o stub; bytes sobem em seguida.
        gallery: gallery.map((g) => ({ name: g.entry.name, size: g.entry.size })),
      });
      // Upload real dos bytes (modo backend; em stub as rotas respondem 501 e
      // os arquivos seguem só em sessão). Falha parcial é explícita, nunca muda.
      const failures: string[] = [];
      for (const g of gallery) {
        if (!g.file) continue;
        try {
          await uploadProductImage(product.code, g.file);
        } catch {
          failures.push(g.entry.name);
        }
      }
      const fresh =
        gallery.length > 0 ? await getProduct(product.code).catch(() => product) : product;
      onDone(fresh);
      // `planWarnings` = o produto EXISTE, mas um preço não virou linha de
      // catálogo (o upstream do plano falhou). Sem reportar, a tela diria
      // "criado com R$ 149,90/mês" para um produto que não vende mensal —
      // exatamente a mentira que o usuário reclamou no histórico de licenças.
      const planWarnings = Array.isArray(product.planWarnings) ? product.planWarnings : [];
      if (planWarnings.length > 0) {
        const ciclos = planWarnings
          .map((w) => (w.interval === "YEAR" ? "anual" : w.interval === "MONTH" ? "mensal" : "um ciclo"))
          .join(", ");
        const msg = `Produto criado, mas ${failures.length > 0 ? `${failures.length} imagem(ns) não subiram e ` : ""}a linha de preço ${ciclos} não foi criada. Reenvie o preço pela aba Planos.`;
        setError(msg);
        notify("warn", "Criação parcial", msg);
        return;
      }
      if (failures.length > 0) {
        // Sem onClose: o erro fica visível p/ reenvio pela aba Galeria.
        const msg = `Produto criado, mas ${failures.length} imagem(ns) não subiram (${failures.slice(0, 3).join(", ")}${failures.length > 3 ? "…" : ""}). Reenvie pela aba Galeria.`;
        setError(msg);
        notify("warn", "Imagens pendentes", msg);
        return;
      }
      onClose();
    } catch (err) {
      // Falha de submit: Toast instrutivo (anúncio acessível) + texto inline
      // persistente sem `role` duplicado.
      setError(notifyError(err).body);
    } finally {
      setPending(false);
    }
  }

  function togglePlatform(id: ProductPlatformId) {
    setPlatformTouched(true);
    setPicked((list) => (list.includes(id) ? list.filter((p) => p !== id) : [...list, id]));
  }

  const pricePreview =
    monthly.cents !== null || annual.cents !== null
      ? [
          monthly.cents !== null ? `R$ ${(monthly.cents / 100).toFixed(2).replace(".", ",")}/mês` : null,
          annual.cents !== null ? `R$ ${(annual.cents / 100).toFixed(2).replace(".", ",")}/ano` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Sem preço ainda";

  return (
    <Dialog open onClose={onClose} title="Novo produto" size="md" material="glass" pending={pending}>
      <RequirePerm perm="product.manage">
        <Stepper step={step} />
        <p className="mt-0 mb-3 text-callout text-text2">
          Ativação por chave · 3 dias de tolerância · entrega{" "}
          {deliveryMode === "HYBRID" ? "híbrida (online + offline)" : "offline"}.
        </p>
        <form onSubmit={handleSubmit}>
          {step === 1 && (
            <div>
              <Field label="Nome do produto" htmlFor="prod-name" hint="Mín. 3 caracteres.">
                <Input
                  id="prod-name"
                  autoFocus
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Ex.: Aurum Pro"
                  autoComplete="off"
                  disabled={pending}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Slug"
                  htmlFor="prod-slug"
                  hint="Único · URL pública."
                  error={slugTaken ? "Slug em uso." : null}
                >
                  <Input
                    id="prod-slug"
                    mono
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value);
                    }}
                    placeholder="aurum-pro"
                    autoComplete="off"
                    disabled={pending}
                    aria-invalid={slugTaken}
                  />
                </Field>
                <Field
                  label="Código"
                  htmlFor="prod-code"
                  hint="Único · operacional."
                  error={codeTaken ? "Código em uso." : null}
                >
                  <Input
                    id="prod-code"
                    mono
                    value={code}
                    onChange={(e) => {
                      setCodeTouched(true);
                      setCode(e.target.value);
                    }}
                    placeholder="AURUM_PRO"
                    autoComplete="off"
                    disabled={pending}
                    aria-invalid={codeTaken}
                  />
                </Field>
              </div>
              <Field
                label="Descrição"
                htmlFor="prod-desc"
                hint={descValid ? `Opcional · ${descLen}/${MAX_DESC}.` : `Máximo ${MAX_DESC} caracteres (atual: ${descLen}).`}
                error={descValid ? null : `Encurte para ${MAX_DESC} caracteres.`}
              >
                <Textarea
                  id="prod-desc"
                  rows={2}
                  maxLength={MAX_DESC + 50}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={pending}
                  placeholder="O que este produto entrega"
                  aria-invalid={!descValid}
                />
              </Field>
              <div className="max-w-[12rem]">
                <Field
                  label="Máquinas / licença"
                  htmlFor="prod-machines"
                  hint="Limite por chave emitida (1 a 100). É este número que a licença vale — não por usuário nem por pedido."
                >
                  <Input
                    id="prod-machines"
                    mono
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    inputMode="numeric"
                    value={machinesRaw}
                    onChange={(e) => setMachinesRaw(e.target.value)}
                    disabled={pending}
                    aria-invalid={!machinesValid}
                  />
                </Field>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mensal (R$)" htmlFor="prod-monthly" hint="Ex.: 149,90">
                  <Input
                    id="prod-monthly"
                    mono
                    autoFocus
                    inputMode="decimal"
                    value={monthlyRaw}
                    onChange={(e) => setMonthlyRaw(e.target.value)}
                    placeholder="0,00"
                    disabled={pending}
                    aria-invalid={!monthly.empty && monthly.cents === null}
                  />
                </Field>
                <Field label="Anual (R$)" htmlFor="prod-annual" hint="Ex.: 1.199,90">
                  <Input
                    id="prod-annual"
                    mono
                    inputMode="decimal"
                    value={annualRaw}
                    onChange={(e) => setAnnualRaw(e.target.value)}
                    placeholder="0,00"
                    disabled={pending}
                    aria-invalid={!annual.empty && annual.cents === null}
                  />
                </Field>
              </div>
              {((!monthly.empty && monthly.cents === null) || (!annual.empty && annual.cents === null)) && (
                <p className="mt-0 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
                  Valor inválido — use o formato 149,90.
                </p>
              )}
              {!hasPrice && monthly.empty && annual.empty && (
                <p className="mt-0 text-callout text-text2">Ao menos um dos dois preços é obrigatório.</p>
              )}
              <div className="mb-3 rounded-base border border-line1 bg-bg2 px-3 py-2">
                <p className="m-0 truncate text-callout text-text1" title={`${name} · ${slug} · ${code} · ${machinesRaw} máq. · ${pricePreview}`}>
                  <span className="font-semibold">{name.trim() || "—"}</span>
                  <span className="text-text2">
                    {" "}· <span className="font-mono tnum text-[0.85em]">{code || "—"}</span> · {machinesRaw} máq. · {pricePreview}
                  </span>
                </p>
              </div>
              <div className="mb-1 flex items-center gap-2">
                <label htmlFor="prod-gallery" className="text-callout font-semibold text-text1">
                  Galeria ({gallery.length}/{MAX_IMAGES})
                </label>
                <span className="text-callout text-text2">até 5 MB cada · sobe na criação</span>
                <label
                  htmlFor="prod-gallery"
                  className="ml-auto inline-flex min-h-[36px] cursor-pointer items-center rounded-base border border-line2 bg-bg2 px-3 text-callout font-semibold text-text1 hover:border-line3 focus-ring"
                >
                  Adicionar
                </label>
                <input
                  ref={fileRef}
                  id="prod-gallery"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFiles(e.target.files)}
                  disabled={pending || gallery.length >= MAX_IMAGES}
                  aria-describedby="prod-gallery-hint"
                  className="sr-only"
                />
              </div>
              <p id="prod-gallery-hint" className="mt-0 text-callout text-text2">
                Sem carrossel no admin — alimenta carrosséis externos via API.
              </p>
              {gallery.length > 0 && (
                <ul className="m-0 mt-2 grid grid-cols-4 gap-1.5 p-0 list-none">
                  {gallery.map((g) => (
                    <li key={g.entry.id} className="relative overflow-hidden rounded-base border border-line1 bg-bg2">
                      {g.entry.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.entry.previewUrl} alt={g.entry.name} className="h-14 w-full object-cover" />
                      ) : (
                        <span className="flex h-14 items-center justify-center px-1 text-center text-callout text-text2">{g.entry.name}</span>
                      )}
                      <Button
                        type="button"
                        variant="icon"
                        size="sm"
                        onClick={() => setGallery((list) => list.filter((x) => x.entry.id !== g.entry.id))}
                        disabled={pending}
                        title={pending ? "Aguarde…" : `Remover imagem ${g.entry.name}`}
                        aria-label={`Remover imagem ${g.entry.name}`}
                        className="absolute right-1 top-1 !min-h-[28px] !w-7 !h-7"
                      >
                        <X size={14} strokeWidth={1.75} aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <p
                id="prod-platforms-label"
                className="mb-1 block font-semibold text-headline text-text1"
              >
                Onde este produto roda?{" "}
                <span className="font-normal text-callout text-text2">pode marcar mais de uma.</span>
              </p>
              <p id="prod-platforms-hint" className="mt-0 text-callout text-text2">
                Usado na landpage e no filtro de compatibilidade. Vira a coluna
                platforms do produto.
              </p>
              <div className="mt-2">
                <PlatformPicker
                  selected={picked}
                  onToggle={togglePlatform}
                  disabled={pending}
                  invalid={platformTouched && !platformsValid}
                  describedBy="prod-platforms-hint"
                />
              </div>
              {!platformsValid && platformTouched && (
                <p
                  className="mt-1 mb-3 text-callout text-danger dark:text-[#ff9a9e]"
                  role="alert"
                >
                  Escolha ao menos uma plataforma.
                </p>
              )}
              <p id="prod-delivery-label" className="mb-1 mt-4 block font-semibold text-headline text-text1">
                Como a licença é entregue?
              </p>
              <DeliveryModeRadio
                name="prod-delivery-mode"
                value={deliveryMode}
                onChange={setDeliveryMode}
                disabled={pending}
              />
              <div className="mt-3 rounded-base border border-line1 bg-bg2 px-3 py-2">
                <p className="m-0 text-callout text-text2">
                  <span className="font-semibold text-text1">Resumo:</span>{" "}
                  <span className="font-mono tnum text-[0.85em]">{code || "—"}</span> ·{" "}
                  {machinesRaw} máq./licença ·{" "}
                  {platforms.length > 0
                    ? platforms.map(platformLabel).join(" · ")
                    : "sem plataforma"}
                  {" · "}
                  {deliveryModeLabel(deliveryMode)}
                  {pricePreview !== "Sem preço ainda" ? ` · ${pricePreview}` : ""}
                </p>
              </div>
            </div>
          )}

          {error && (
            <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]">
              <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 mt-4">
            {step === 1 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={pending}
                title={pending ? "Aguarde…" : "Cancelar"}
              >
                Cancelar
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(step === 3 ? 2 : 1)}
                disabled={pending}
                title={pending ? "Aguarde…" : step === 3 ? "Voltar para preços e galeria" : "Voltar à etapa básica"}
              >
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                Voltar
              </Button>
            )}
            {step === 1 ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => setStep(2)}
                disabled={!step1Valid || pending}
                title={pending ? "Aguarde…" : !step1Valid ? "Preencha nome, slug/código únicos, máquinas e descrição ≤ 500" : "Continuar para preços e galeria"}
              >
                Continuar
                <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            ) : step === 2 ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setPlatformTouched(true);
                  setStep(3);
                }}
                disabled={pending}
                title={pending ? "Aguarde…" : "Continuar para plataformas e entrega"}
              >
                Continuar
                <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                loading={pending}
                loadingLabel="Criando…"
                disabled={!valid || pending}
                title={
                  pending
                    ? "Criando…"
                    : !valid
                      ? !platformsValid
                        ? "Escolha ao menos uma plataforma"
                        : "Preencha ao menos um preço válido"
                      : "Criar produto"
                }
              >
                Criar produto
              </Button>
            )}
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}

"use client";

import { useRef, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { createProduct, getProduct, uploadProductImage } from "@/lib/products";
import type { ProductImage, ProductView } from "@/lib/types";

/** "149,90" / "149.90" → centavos; `null` = vazio ou inválido (ver `empty`). */
function parseBRLCents(raw: string): { empty: boolean; cents: number | null } {
  const t = raw.trim();
  if (t === "") return { empty: true, cents: null };
  const norm = t.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return { empty: false, cents: null };
  const v = Number(norm);
  if (!Number.isFinite(v) || v <= 0) return { empty: false, cents: null };
  return { empty: false, cents: Math.round(v * 100) };
}

function slugify(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function codeify(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_").slice(0, 60);
}

function toSubmitError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Falha ao criar produto.";
  if (/409|CONFLICT|já existe|duplicad/i.test(msg)) {
    return "product code/slug já existe — escolha outro código ou slug.";
  }
  return msg;
}

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Seleção local com bytes p/ upload real (File) + thumb de sessão (preview). */
interface PendingImage {
  entry: ProductImage;
  file: File | null;
}

/**
 * Criação de produto com licenças offline (Dialog glass md — molde de criação).
 * - Nome (≥3) → slug/código auto-derivados, editáveis (trava após toque manual).
 * - Máquinas simultâneas 1..100; ao menos um preço (mensal/anual em R$).
 * - Galeria em sessão via FileReader (thumbs + remover; SEM carrossel no admin —
 *   DS v1 proíbe; a galeria alimenta carrosséis externos via API).
 * Exige `product.manage`.
 * TODO(backend pronto): `POST /v1/products` + object storage p/ a galeria
 * (hoje só metadados nome/tamanho seguem no `req`; `previewUrl` é sessão).
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
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [slug, setSlug] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [machinesRaw, setMachinesRaw] = useState("3");
  const [monthlyRaw, setMonthlyRaw] = useState("");
  const [annualRaw, setAnnualRaw] = useState("");
  const [gallery, setGallery] = useState<PendingImage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
  const valid =
    nameValid && slugValid && codeValid && !codeTaken && !slugTaken && machinesValid && monthlyOk && annualOk && hasPrice;

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
      if (failures.length > 0) {
        // Sem onClose: o erro fica visível p/ reenvio pela aba Galeria.
        setError(
          `Produto criado, mas ${failures.length} imagem(ns) não subiram (${failures.slice(0, 3).join(", ")}${failures.length > 3 ? "…" : ""}). Reenvie pela aba Galeria.`,
        );
        return;
      }
      onClose();
    } catch (err) {
      setError(toSubmitError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Novo produto" size="md" material="glass" pending={pending}>
      <RequirePerm perm="product.manage">
        <p className="mt-0 text-callout text-text2">
          Produto com licenças offline (ativação por chave, tolerância degradada de 3 dias).
          Código e slug são únicos.
        </p>
        <form onSubmit={handleSubmit}>
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
          <Field
            label="Slug"
            htmlFor="prod-slug"
            hint="Derivado do nome; editável; único (URL pública do catálogo)."
            error={slugTaken ? "Este slug já está em uso." : null}
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
            hint="Derivado do slug; editável; único (identificador operacional)."
            error={codeTaken ? "Este código já está em uso." : null}
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
          <Field label="Descrição" htmlFor="prod-desc">
            <Textarea
              id="prod-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
              placeholder="O que este produto entrega"
            />
          </Field>
          <Field label="Máquinas simultâneas" htmlFor="prod-machines" hint="Limite por licença: 1 a 100.">
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
            />
          </Field>
          <Field label="Preço mensal (R$, opcional)" htmlFor="prod-monthly" hint="Ex.: 149,90">
            <Input
              id="prod-monthly"
              mono
              inputMode="decimal"
              value={monthlyRaw}
              onChange={(e) => setMonthlyRaw(e.target.value)}
              placeholder="0,00"
              disabled={pending}
              aria-invalid={!monthly.empty && monthly.cents === null}
            />
          </Field>
          <Field
            label="Preço anual (R$, opcional)"
            htmlFor="prod-annual"
            hint="Ex.: 1.199,90 — ao menos um dos dois preços é obrigatório."
          >
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
          {((!monthly.empty && monthly.cents === null) || (!annual.empty && annual.cents === null)) && (
            <p className="text-callout text-danger dark:text-[#ff9a9e]" role="alert">
              Valor inválido — use o formato 149,90.
            </p>
          )}
          <div className="mb-4">
            <label htmlFor="prod-gallery" className="block mb-1 font-semibold text-headline text-text1">
              Galeria ({gallery.length}/{MAX_IMAGES})
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
              className="block w-full min-h-[44px] text-body text-text1 focus-ring"
            />
            <p id="prod-gallery-hint" className="mt-1 text-callout text-text2">
              Imagens até 5 MB — sobem p/ a VPS na criação (modo backend). Sem
              carrossel no admin — a galeria alimenta carrosséis externos via API.
            </p>
            {gallery.length > 0 && (
              <ul className="m-0 mt-2 grid grid-cols-3 gap-2 p-0 list-none">
                {gallery.map((g) => (
                  <li key={g.entry.id} className="relative rounded-base border border-line1 bg-bg2 p-1">
                    {g.entry.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.entry.previewUrl} alt={g.entry.name} className="h-20 w-full rounded-base object-cover" />
                    ) : (
                      <span className="flex h-20 items-center justify-center text-callout text-text2">{g.entry.name}</span>
                    )}
                    <span className="block truncate px-1 pt-1 text-caption text-text2" title={g.entry.name}>
                      {g.entry.name} · {Math.max(1, Math.round(g.entry.size / 1024))} KB
                    </span>
                    <Button
                      type="button"
                      variant="icon"
                      onClick={() => setGallery((list) => list.filter((x) => x.entry.id !== g.entry.id))}
                      disabled={pending}
                      title={pending ? "Aguarde…" : `Remover imagem ${g.entry.name}`}
                      aria-label={`Remover imagem ${g.entry.name}`}
                      className="absolute right-1 top-1"
                    >
                      <X size={16} strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && (
            <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
              <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
              title={pending ? "Aguarde…" : "Cancelar"}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              loadingLabel="Criando…"
              disabled={!valid || pending}
              title={pending ? "Criando…" : !valid ? "Preencha nome, código/slug únicos, máquinas e ao menos um preço" : "Criar produto"}
            >
              Criar produto
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}

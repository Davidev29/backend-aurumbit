"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Pencil, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { useToast } from "@/lib/toast";
import { patchProduct, putProduct } from "@/lib/products";
import type { ProductView, ProductWriteResponse } from "@/lib/types";
import {
  normalizePlatformIds,
  type ProductDeliveryMode,
  type ProductPlatformId,
} from "@/lib/platforms";
import { DeliveryModeRadio, PlatformPicker } from "./PlatformPicker";

/** Mesmo regex do `PRODUCT_SLUG_PATTERN` do Nest — a UI nunca sugere o que o backend recusa. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 500;

/** Estado local do formulário (strings cruas; a validação é do dono do campo). */
type Form = {
  name: string;
  slug: string;
  description: string;
  machines: string;
  platforms: ProductPlatformId[];
  deliveryMode: ProductDeliveryMode;
};

function formOf(product: ProductView): Form {
  return {
    name: product.name,
    slug: product.slug,
    description: product.description ?? "",
    machines: String(product.machinesAllowed ?? 3),
    platforms: normalizePlatformIds(product.platforms ?? []),
    deliveryMode: product.deliveryMode === "HYBRID" ? "HYBRID" : "OFFLINE",
  };
}

/**
 * Só os campos que MUDAM: é o que o PATCH envia (ausente = preservado).
 *
 * `platforms` compara como CONJUNTO (o picker pode devolver ids fora da ordem
 * canônica; o banco e a resposta usam a ordem do catálogo) e `description`
 * compara já sem as bordas — senão "nada alterado" nunca apareceria e o PATCH
 * reenviaria platforms a cada clique.
 */
function changedKeys(product: ProductView, form: Form): Array<keyof Form> {
  const base = formOf(product);
  return (Object.keys(base) as Array<keyof Form>).filter((key) => {
    if (key === "platforms") {
      const a = base.platforms;
      const b = form.platforms;
      return a.length !== b.length || a.some((id) => !b.includes(id));
    }
    if (key === "description") {
      return form.description.trim() !== (product.description ?? "").trim();
    }
    return base[key] !== form[key];
  });
}

/**
 * Edição de produto (PATCH parcial) e substituição total (PUT).
 *
 * DECISÃO DE UI — os dois verbos ficam em UM diálogo com DOIS botões, e não
 * em dois diálogos:
 * - o operador quase sempre quer "mudei o nome e as plataformas" (PATCH); o
 *   botão padrão faz isso, enviando só o que mudou;
 * - "Substituir tudo" (PUT) é a exceção: zera o que vier vazio/`null`, então
 *   fica visualmente separado (ghost, à direita da DestructionForm de 2
 *   passos), com a confirmação escrita por extenso.
 *
 * Se fossem dois diálogos, ninguém encontraria o PUT — e PUT é justamente o
 * que precisa ser difícil de acionar por engano. Já deixar PUT como um
 * "advanced toggle" dentro do formulário esconderia que ele tem efeito
 * destrutivo em campos.
 *
 * REGRA DE `platforms` vazia (rev. 2026-10-17, alinha F-15): PATCH libera
 * lista vazia (edição pontual — produto em pré-venda pode ficar sem
 * plataforma declarada); PUT exige >= 1 (substituição total precisa declarar
 * onde o produto roda, como no POST). O checkbox do PUT fica desabilitado sem
 * plataforma, com aviso — assim a tela não promete o que o servidor recusa.
 */
export function EditProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: ProductView;
  onClose: () => void;
  /** Recebe o produto já normalizado pelo BFF (mesmo shape do GET). */
  onSaved: (product: ProductView, mode: ProductWriteResponse["mode"]) => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(product));
  const [pending, setPending] = useState<null | "PATCH" | "PUT">(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPut, setConfirmPut] = useState(false);
  const { notify, notifyError } = useToast();

  // Produto novo (troca de code sem fechar o modal) → formulário acompanha.
  useEffect(() => {
    setForm(formOf(product));
    setConfirmPut(false);
    setError(null);
    setFieldError(null);
  }, [product]);

  const changed = useMemo(() => changedKeys(product, form), [product, form]);
  const slugDirty = form.slug.trim() !== product.slug;
  const machines = Number(form.machines);
  const platforms = normalizePlatformIds(form.platforms);
  const descriptionText = form.description.trim();
  /** Vazio = "sem descrição": vai como `null` (limpa), nunca `""` no banco. */
  const descriptionCleared = descriptionText === "" && (product.description ?? "").trim() !== "";

  const nameValid = form.name.trim().length >= 2 && form.name.trim().length <= 120;
  const slugValid = SLUG_PATTERN.test(form.slug.trim());
  const machinesValid = Number.isInteger(machines) && machines >= 1 && machines <= 100;
  const descriptionValid = form.description.trim().length <= MAX_DESCRIPTION;
  /**
   * REGRA POR VERBO (rev. 2026-10-17, F-15) — espelha a BFF e o Nest:
   * - PATCH aceita lista vazia: é edição pontual, e produto em pré-venda pode
   *   legitimamente ficar sem plataforma declarada (é o default do banco).
   * - PUT exige >= 1: substituição total precisa declarar onde o produto roda.
   */
  const platformsAnyValid = platforms.length >= 0;
  const platformsFullValid = platforms.length > 0;
  /** Campos comuns + plataformas conforme o verbo. */
  const validFor = (mode: "PATCH" | "PUT") =>
    nameValid &&
    slugValid &&
    machinesValid &&
    descriptionValid &&
    (mode === "PUT" ? platformsFullValid : platformsAnyValid);

  function patch(key: keyof Form, value: Form[keyof Form]) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldError(null);
  }

  function togglePlatform(id: ProductPlatformId) {
    setFieldError(null);
    setForm((f) => {
      const next = f.platforms.includes(id) ? f.platforms.filter((p) => p !== id) : [...f.platforms, id];
      return { ...f, platforms: next };
    });
  }

  async function submit(mode: "PATCH" | "PUT") {
    if (!validFor(mode) || pending) return;
    setPending(mode);
    setError(null);
    setFieldError(null);
    try {
      const full = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: descriptionText === "" ? null : descriptionText,
        machinesAllowed: machines,
        platforms,
        deliveryMode: form.deliveryMode,
      };
      const saved =
        mode === "PATCH"
          ? // Só o que mudou: preserva o resto (PATCH é parcial por contrato).
            await patchProduct(product.code, diffPayload(product, form, full))
          : await putProduct(product.code, full);
      setNotice(
        mode === "PATCH"
          ? "Alterações salvas (PATCH: só o que você mudou foi gravado)."
          : "Produto substituído (PUT: todos os campos foram regravados).",
      );
      if (saved.mode === "stub") {
        notify(
          "warn",
          "Alteração só no stub",
          saved.notice ?? "API_INTERNAL_URL ausente — nada foi gravado no banco.",
        );
      } else {
        notify("success", mode === "PATCH" ? "Alterações salvas" : "Produto substituído", product.code);
      }
      onSaved(saved, saved.mode);
      if (mode === "PATCH") onClose();
    } catch (err) {
      // 409/422 chegam com a mensagem real do upstream ("slug já em uso") —
      // `notifyError` a achata e o campo mais provável é apontado abaixo.
      setError(notifyError(err, "Falha ao salvar o produto.").body);
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Editar produto — ${product.name}`}
      size="md"
      material="glass"
      pending={pending !== null}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending !== null} title={pending ? "Aguarde…" : "Cancelar sem salvar"}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => submit("PATCH")}
            loading={pending === "PATCH"}
            loadingLabel="Salvando…"
            disabled={!validFor("PATCH") || changed.length === 0 || pending !== null}
            title={
              pending
                ? "Aguarde…"
                : !validFor("PATCH")
                  ? "Corrija nome, slug e máquinas antes de salvar"
                  : changed.length === 0
                    ? "Nada alterado — mude um campo para salvar"
                    : `Salvar ${changed.length} ${changed.length === 1 ? "campo" : "campos"} (PATCH)`
            }
          >
            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
            Salvar alterações ({changed.length})
          </Button>
        </>
      }
    >
      <RequirePerm perm="product.manage">
        <p className="mt-0 mb-3 text-callout text-text2">
          <span className="font-semibold text-text1">PATCH</span> grava só o que mudou (o resto
          fica como está). <span className="font-semibold text-text1">PUT</span> substitui o produto
          inteiro: campos vazios são <strong className="text-text1">zerados</strong>, então só use
          quando quiser regravar todos os campos de uma vez.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit("PATCH");
          }}
        >
          <Field
            label="Nome do produto"
            htmlFor="edit-name"
            hint="2 a 120 caracteres."
            error={!nameValid ? "Nome deve ter entre 2 e 120 caracteres." : null}
          >
            <Input
              id="edit-name"
              autoFocus
              value={form.name}
              onChange={(e) => patch("name", e.target.value)}
              disabled={pending !== null}
              maxLength={120}
              autoComplete="off"
              aria-invalid={!nameValid}
            />
          </Field>

          <Field
            label="Slug"
            htmlFor="edit-slug"
            hint="URL pública (SEO). Não pode ser alterado depois sem quebrar links."
            error={!slugValid ? 'Slug lower-kebab: apenas a-z, 0-9 e hífen simples (ex.: "aurum-pro").' : null}
          >
            <Input
              id="edit-slug"
              mono
              value={form.slug}
              onChange={(e) => patch("slug", e.target.value)}
              disabled={pending !== null}
              maxLength={120}
              autoComplete="off"
              aria-invalid={!slugValid}
            />
          </Field>

          {slugDirty && (
            <p
              className="-mt-2 mb-4 flex items-start gap-1.5 text-callout text-text2"
              role="status"
            >
              <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
              <span>
                Trocar o slug de <code className="font-mono tnum">{product.slug}</code> para{" "}
                <code className="font-mono tnum">{form.slug.trim()}</code> quebra os links já
                publicados (o antigo responde 404). Confirme que a mudança é intencional.
              </span>
            </p>
          )}

          <Field
            label="Descrição"
            htmlFor="edit-desc"
            hint={
              descriptionCleared
                ? "Deixando vazio, a descrição é LIMPA (não preservada)."
                : `Opcional · ${form.description.trim().length}/${MAX_DESCRIPTION}.`
            }
            error={!descriptionValid ? `Máximo ${MAX_DESCRIPTION} caracteres.` : null}
          >
            <Textarea
              id="edit-desc"
              rows={2}
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              disabled={pending !== null}
              maxLength={MAX_DESCRIPTION + 50}
              placeholder="O que este produto entrega"
              aria-invalid={!descriptionValid}
            />
          </Field>

          <div className="max-w-[12rem]">
            <Field
              label="Máquinas / licença"
              htmlFor="edit-machines"
              hint="Vale para chaves NOVAS. Licenças já emitidas mantêm o limite vigente — este campo não as reescreve."
              error={!machinesValid ? "Inteiro entre 1 e 100." : null}
            >
              <Input
                id="edit-machines"
                mono
                type="number"
                min={1}
                max={100}
                step={1}
                inputMode="numeric"
                value={form.machines}
                onChange={(e) => patch("machines", e.target.value)}
                disabled={pending !== null}
                aria-invalid={!machinesValid}
              />
            </Field>
          </div>

          <p id="edit-platforms-label" className="mb-1 block font-semibold text-headline text-text1">
            Onde este produto roda?{" "}
            <span className="font-normal text-callout text-text2">pode marcar mais de uma.</span>
          </p>
          <PlatformPicker
            selected={form.platforms}
            onToggle={togglePlatform}
            disabled={pending !== null}
            invalid={!platformsFullValid && fieldError !== null && pending === "PUT"}
          />
          {!platformsFullValid && (
            /* AVISO, não erro: no PATCH a lista vazia é válida (regra F-15).
               Só a substituição total exige plataforma — o bloqueio real está
               no botão do PUT, que fica desabilitado com motivo explícito. */
            <p className="mt-1 text-callout text-text2">
              Sem plataforma declarada: o produto continua visível na landpage, mas{" "}
              <strong className="text-text1">sem o selo de plataforma</strong> e não aparece nos
              filtros de compatibilidade. Salvar alterações (PATCH) aceita assim; substituir tudo
              (PUT) exige ao menos uma.
            </p>
          )}

          <p id="edit-delivery-label" className="mb-1 mt-4 block font-semibold text-headline text-text1">
            Como a licença é entregue?
          </p>
          <DeliveryModeRadio
            name="edit-delivery-mode"
            value={form.deliveryMode}
            onChange={(v) => patch("deliveryMode", v)}
            disabled={pending !== null}
          />

          {notice && (
            <p className="mt-4 flex items-center gap-1.5 text-callout text-text1" role="status">
              <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-accent" />
              {notice}
            </p>
          )}
          {error && (
            <p
              className="mt-4 flex items-start gap-2 text-callout text-danger dark:text-[#ff9a9e]"
              role="alert"
            >
              <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                {error}
                {/slug|já (está )?em uso|409/i.test(error) && (
                  <>
                    {" "}
                    <span className="text-text2">
                      (409 = o slug pertence a outro produto; escolha outro.)
                    </span>
                  </>
                )}
              </span>
            </p>
          )}

          {/* PUT fica ABAIXO, separado do botão principal: é a operação que zera. */}
          <div className="mt-4 rounded-base border border-line2 bg-bg2 px-2.5 py-2">
            <p className="m-0 mb-1 text-callout font-semibold text-text1">
              Substituir tudo (PUT)
            </p>
            <p className="m-0 mb-2 text-[11px] leading-4 text-text2">
              Regrava os 6 campos a partir do formulário. Descrição vazia vira{" "}
              <code className="font-mono tnum">null</code> (apagada) — não há como desfazer pela
              UI. Plataformas <strong className="text-text1">não podem ficar vazias</strong> aqui:
              quem substitui o produto inteiro precisa declarar onde ele roda. Para retirar as
              plataformas, use <strong className="text-text1">Salvar alterações</strong> acima.
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-callout text-text2">
              <input
                type="checkbox"
                checked={confirmPut}
                onChange={(e) => setConfirmPut(e.target.checked)}
                disabled={pending !== null || platforms.length === 0}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span>
                Entendo que campos vazios serão <strong className="text-text1">zerados</strong> e
                quero substituir o produto inteiro.
              </span>
            </label>
            {platforms.length === 0 && (
              <p className="m-0 mt-1 text-[11px] leading-4 text-text2">
                Marque ao menos uma plataforma para liberar a substituição total.
              </p>
            )}
            <div className="mt-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => submit("PUT")}
                loading={pending === "PUT"}
                loadingLabel="Substituindo…"
                disabled={!validFor("PUT") || !confirmPut || pending !== null}
                title={
                  pending
                    ? "Aguarde…"
                    : !platformsFullValid
                      ? "Escolha ao menos uma plataforma para substituir o produto inteiro"
                      : !validFor("PUT")
                        ? "Corrija os campos antes de substituir"
                        : !confirmPut
                          ? "Confirme que entende que campos vazios serão zerados"
                          : "Substituir o produto inteiro (PUT)"
                }
              >
                <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
                Substituir produto (PUT)
              </Button>
            </div>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}

/** Só os campos alterados — é o que define um PATCH. */
function diffPayload(
  product: ProductView,
  form: Form,
  full: {
    name: string;
    slug: string;
    description: string | null;
    machinesAllowed: number;
    platforms: ProductPlatformId[];
    deliveryMode: ProductDeliveryMode;
  },
): Record<string, unknown> {
  const changed = new Set(changedKeys(product, form));
  const out: Record<string, unknown> = {};
  if (changed.has("name")) out.name = full.name;
  if (changed.has("slug")) out.slug = full.slug;
  if (changed.has("description")) out.description = full.description;
  if (changed.has("machines")) out.machinesAllowed = full.machinesAllowed;
  if (changed.has("platforms")) out.platforms = full.platforms;
  if (changed.has("deliveryMode")) out.deliveryMode = full.deliveryMode;
  return out;
}

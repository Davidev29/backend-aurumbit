"use client";

import { Check, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DELIVERY_MODE_OPTIONS,
  PRODUCT_PLATFORMS,
  normalizePlatformIds,
  platformLabel,
  type ProductDeliveryMode,
  type ProductPlatformId,
} from "@/lib/platforms";

/**
 * Ícone de PLATAFORMA — segue a regra canônica do DS (rev. 2026-10-17, §1 e
 * §4 "Bitmap de plataforma é a exceção conhecida").
 *
 * Aqui o bitmap de marca é a regra, não a exceção: `lucide-react` continuaria
 * valendo para ícone de ação/estado, mas "qual plataforma" é informação e um
 * ícone genérico (`Monitor` para Windows e macOS, `Cpu` para Linux) confunde
 * em vez de informar.
 *
 * Os PNGs de `public/tags/` são gerados por `tools/build-tag-icons.py` (fonte
 * da verdade dos ids, rótulos e variante dark) — nunca editar o PNG direto.
 *
 * O resto do DS continua lei e é cumprido aqui:
 * - alvo de toque 44px (DS §9);
 * - seleção visível SEM depender só de cor (DS §1: cue não-cor obrigatório) →
 *   `aria-pressed` + borda/ring + ícone `Check` + rótulo;
 * - tokens via `var(--*)` / utilitários Tailwind do tema (sem hex cru);
 * - `alt=""` + `aria-hidden` nos PNGs decorativos (o rótulo pt-BR já está
 *   ao lado — o leitor de tela não deve ler "imagem, imagem, imagem");
 * - a variante `-dark` da Apple existe porque a marca é preta e sumiria em
 *   `--bg-0` do tema dark (o default do DS).
 *
 * PNG em `<img>` puro: o padrão do repo para bytes em `/public`
 * (`next/image` não é usado em nenhum componente admin e o eslint tem
 * `@next/next/no-img-element` desligado por arquivo via comentário).
 */
function PlatformIcon({ id, label }: { id: ProductPlatformId; label: string }) {
  const option = PRODUCT_PLATFORMS.find((p) => p.id === id);
  if (!option) return null;
  return (
    <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
      {!option.darkSrc ? (
        <img src={option.src} alt="" width={24} height={24} className="h-6 w-6 object-contain" loading="lazy" />
      ) : (
        <>
          <img
            src={option.src}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 object-contain dark:hidden"
            loading="lazy"
          />
          <img
            src={option.darkSrc}
            alt=""
            width={24}
            height={24}
            className="hidden h-6 w-6 object-contain dark:block"
            loading="lazy"
          />
        </>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Leitura (não-edição) das plataformas de um produto já salvo.
 *
 * Existe para o dado coletado na criação não sumir: o operador escolhe as
 * plataformas uma vez e precisa reencontrá-las no detalhe. Mesmo PNGs, mesma
 * variante dark, mesmos rótulos pt-BR da fonte da verdade.
 *
 * `[]` = produto legado, criado antes da coluna (`DEFAULT '{}'`) — mostra
 * "não informado" em vez de fingir que existe escolha.
 */
export function PlatformIcons({ ids }: { ids: readonly string[] }) {
  const known = normalizePlatformIds(ids);
  if (known.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-callout text-text2">
        <Info size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        não informado
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {known.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 text-callout text-text1">
          <PlatformIcon id={id} label={platformLabel(id)} />
          <span>{platformLabel(id)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Seletor MULTI de plataformas (um produto roda em Windows + Web ao mesmo
 * tempo — não é radio).
 *
 * A ordem dos tiles é a ordem CANÔNICA do catálogo (`PRODUCT_PLATFORM_IDS`),
 * não a ordem de clique, para a lista bater com o que o backend grava.
 */
export function PlatformPicker({
  selected,
  onToggle,
  disabled,
  invalid,
  describedBy,
}: {
  selected: readonly ProductPlatformId[];
  onToggle: (id: ProductPlatformId) => void;
  disabled?: boolean;
  /** `true` quando nenhuma plataforma foi escolhida e o erro está visível. */
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div
      role="group"
      aria-labelledby="prod-platforms-label"
      aria-describedby={describedBy}
      className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
    >
      {PRODUCT_PLATFORMS.map((p) => {
        const on = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onToggle(p.id)}
            title={disabled ? "Aguarde…" : `${on ? "Remover" : "Adicionar"} ${p.label}`}
            className={cn(
              // 44px de alvo (DS §9). Borda 2px visível + `Check` = cue não-cor.
              "flex min-h-[44px] items-center gap-2 rounded-base border-2 px-2 text-left focus-ring",
              "disabled:cursor-not-allowed disabled:opacity-45",
              on
                ? "border-accent bg-accentsoft text-text1"
                : invalid
                  ? "border-danger bg-bg2 text-text2 hover:border-line3 hover:text-text1"
                  : "border-line2 bg-bg2 text-text2 hover:border-line3 hover:text-text1",
            )}
          >
            <PlatformIcon id={p.id} label={p.label} />
            <span className="min-w-0 flex-1 truncate text-callout font-semibold">{p.label}</span>
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                on ? "border-accent bg-accent text-accentink" : "border-line3 bg-transparent",
              )}
            >
              {on && <Check size={11} strokeWidth={2.5} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Radio de 2 opções (OFFLINE | HYBRID) — o usuário pediu explicitamente
 * "se é Offline completo ou tem arquitetura híbrida".
 * Radio e não toggle: são estados mutuamente exclusivos e a label importa
 * (quem lê o rótulo entende a diferença sem saber o que é HYBRID).
 */
export function DeliveryModeRadio({
  value,
  onChange,
  disabled,
  name,
}: {
  value: ProductDeliveryMode;
  onChange: (v: ProductDeliveryMode) => void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby="prod-delivery-label" className="grid grid-cols-2 gap-1.5">
      {DELIVERY_MODE_OPTIONS.map((opt) => {
        const on = value === opt.value;
        return (
          <label
            key={opt.value}
            className={cn(
              "flex min-h-[44px] cursor-pointer items-start gap-2 rounded-base border-2 px-2 py-1.5 focus-within:ring-2",
              disabled && "cursor-not-allowed opacity-45",
              on ? "border-accent bg-accentsoft" : "border-line2 bg-bg2 hover:border-line3",
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={on}
              disabled={disabled}
              onChange={() => onChange(opt.value)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-callout font-semibold text-text1">{opt.label}</span>
              <span className="block text-[11px] leading-4 text-text2">{opt.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

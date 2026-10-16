"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductMedia } from "@/types";

interface ProductModalBackgroundProps {
  media: ProductMedia[];
  productName: string;
}

/** Tempo de cada foto no carrossel (vídeo avança no `ended`). */
const IMAGE_DWELL_MS = 5000;
/** Rede de segurança: vídeo travado não prende o carrossel. */
const VIDEO_FALLBACK_MS = 30000;

function isVideo(m: ProductMedia): boolean {
  if (m.kind === "video") return true;
  if (m.kind === "image") return false;
  const mime = (m.mime ?? "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(m.url);
}

/**
 * Fundo do modal do produto: a mídia cobre o painel e recebe por cima o
 * mesmo vidro do banner (`hero-brand-veil` + `hero-brand-glass`, byte-igual
 * ao `HeroBrandBanner`). Várias imagens alternam em crossfade suave; vídeo
 * avança sozinho ao terminar (`onEnded` → próximo).
 *
 * Acessibilidade: respeita `prefers-reduced-motion` (sem troca automática),
 * controles com alvo ≥44px e região `aria-roledescription="carousel"`.
 */
export function ProductModalBackground({ media, productName }: ProductModalBackgroundProps) {
  const idsKey = useMemo(() => media.map((m) => m.id).join("|"), [media]);
  const items = useMemo(
    () => media.filter((m) => typeof m.url === "string" && m.url.length > 0),
    [media]
  );
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setIndex(0);
    setFailed({});
  }, [idsKey]);

  const visible = useMemo(() => items.filter((m) => !failed[m.id]), [items, failed]);
  const count = visible.length;
  const safeIndex = count > 0 ? index % count : 0;
  const current = count > 0 ? visible[safeIndex] : undefined;
  const currentIsVideo = current ? isVideo(current) : false;

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count]
  );

  // Fotos avançam sozinhas; vídeo avança no `ended` (com fallback por tempo).
  useEffect(() => {
    if (count <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timer.current = window.setTimeout(
      () => go(safeIndex + 1),
      currentIsVideo ? VIDEO_FALLBACK_MS : IMAGE_DWELL_MS
    );
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [safeIndex, count, currentIsVideo, current?.id, go]);

  const markFailed = useCallback((id: string) => {
    setFailed((f) => (f[id] ? f : { ...f, [id]: true }));
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Camada 1 — mídia (foto cobre; vídeo toca sem som, em sequência) */}
      {count === 0 ? (
        <div
          className="absolute inset-0 bg-gradient-to-br from-accent/25 via-bg2 to-bg2"
          aria-hidden="true"
        >
          <div className="bg-grid-gold absolute inset-0 opacity-70" aria-hidden="true" />
        </div>
      ) : (
        <div
          role="group"
          aria-roledescription="carousel"
          aria-label={`Mídia de ${productName}`}
          className="absolute inset-0"
        >
          {visible.map((m, i) => {
            const active = i === safeIndex;
            if (isVideo(m)) {
              if (!active) return null;
              return (
                <video
                  key={m.id}
                  className="product-modal-media is-on absolute inset-0 h-full w-full object-cover"
                  src={m.url}
                  poster={m.poster}
                  autoPlay
                  muted
                  playsInline
                  preload="auto"
                  loop={count === 1}
                  aria-label={m.alt || productName}
                  onEnded={() => go(safeIndex + 1)}
                  onError={() => markFailed(m.id)}
                />
              );
            }
            return (
              <img
                key={m.id}
                src={m.url}
                alt=""
                aria-hidden="true"
                draggable={false}
                onError={() => markFailed(m.id)}
                className={cn(
                  "product-modal-media absolute inset-0 h-full w-full object-cover",
                  active && "is-on"
                )}
              />
            );
          })}
        </div>
      )}

      {/* Camada 2 e 3 — véu + vidro idênticos aos do banner da landpage */}
      <div className="hero-brand-veil" aria-hidden="true" />
      <div className="hero-brand-glass" aria-hidden="true" />

      {/* Camada 4 — paginação (única parte clicável do fundo) */}
      {count > 1 && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-2 z-10 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => go(safeIndex - 1)}
            aria-label="Mídia anterior"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text2 transition-colors hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Escolher mídia">
            {visible.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={i === safeIndex}
                aria-label={`Mídia ${i + 1} de ${count}`}
                onClick={() => go(i)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-500",
                    i === safeIndex ? "w-6 bg-accent" : "w-1.5 bg-text3/60"
                  )}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(safeIndex + 1)}
            aria-label="Próxima mídia"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text2 transition-colors hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

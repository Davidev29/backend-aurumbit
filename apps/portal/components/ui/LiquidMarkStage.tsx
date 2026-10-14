"use client";

import * as React from "react";
import { LiquidEngine, hexToRgb, type EngineOptions } from "./liquid-sculpture-hero";
import { cn } from "@/lib/utils";

/**
 * Palco líquido dedicado — 1 instância enxuta do `LiquidEngine` para uma
 * imagem persistente (a logomarca). Sem nav/copy do `SculptureHero`: o pai
 * controla tamanho e layout; a imagem nunca troca, então a logo NUNCA some.
 *
 * Fallback: `<img>` estática sob o canvas (WebGL ausente = logo nítida).
 */

export interface LiquidMarkStageProps {
  /** dataURL/imagem da arte (fundo transparente). Trocar o valor refaz as partículas com dip. */
  src: string | null;
  interactive?: boolean;
  /** Aspecto da arte (w/h) para letterbox sem distorcer. Omitido = preenche o palco. */
  aspect?: number;
  /** Física — defaults do padrão líquido; a logo usa valores turbinados. */
  density?: number;
  strength?: number;
  radius?: number;
  dotSize?: number;
  returnSpeed?: number;
  /** Fluxo global no hover (0 = só o raio do cursor; nunca >0 nos textos). */
  liquid?: number;
  ambient?: boolean;
  ambientIntensity?: number;
  /** Atraso da criação do motor pós-mount: escalona o custo de partida
      (compila shaders + 1ª pintura primeiro). Fallback estático cobre. */
  startupDelay?: number;
  className?: string;
}

export function LiquidMarkStage({
  src,
  interactive = true,
  aspect,
  density = 1.1,
  strength = 1,
  radius = 200,
  dotSize = 1.15,
  returnSpeed = 1.3,
  liquid = 0,
  ambient = false,
  ambientIntensity = 1,
  startupDelay = 0,
  className,
}: LiquidMarkStageProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const engineRef = React.useRef<LiquidEngine | null>(null);
  const [engineReady, setEngineReady] = React.useState(false);
  const interactiveRef = React.useRef(interactive);
  React.useEffect(() => {
    interactiveRef.current = interactive;
    engineRef.current?.setOptions({ interactive });
  }, [interactive]);

  const aspectRef = React.useRef<number | undefined>(aspect);
  React.useEffect(() => {
    aspectRef.current = aspect;
  }, [aspect]);

  // Ciclo de vida: listeners/canvas na hora; motor criado DEPOIS da 1ª
  // pintura (escalonado por `startupDelay`) para não congelar o load.
  React.useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;

    const canvas = document.createElement("canvas");
    canvas.className = "lm-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const opts = (rm: boolean): EngineOptions => ({
      interactive: interactiveRef.current,
      strength,
      radius,
      density,
      dotSize,
      spread: 1,
      turbulence: 1,
      liquid,
      streaks: false,
      restStyle: "image",
      returnSpeed,
      ambient,
      ambientIntensity,
      speed: 1,
      intro: false,
      reducedMotion: rm,
      bg: hexToRgb("#090806", [0.035, 0.031, 0.024]),
      imgBg: null,
    });

    let engine: LiquidEngine | null = null;
    const fail = () => {
      root.dataset.gl = "off";
    };
    // Criação adiada: 1ª pintura + fallback estático primeiro, WebGL depois.
    const timer = window.setTimeout(() => {
      try {
        engine = new LiquidEngine(canvas, opts(mq.matches), fail);
        engineRef.current = engine;
      } catch {
        fail();
        return;
      }
      relayout();
      setEngineReady(true);
    }, startupDelay);

    const relayout = () => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      if (w < 1 || h < 1) return;
      const ar = aspectRef.current;
      if (!ar) {
        engineRef.current?.resize(w, h, { x: 0, y: 0, w, h });
        return;
      }
      // Letterbox: preserva o aspecto da arte, sem esticar partículas.
      let rw = w;
      let rh = w / ar;
      if (rh > h) {
        rh = h;
        rw = h * ar;
      }
      engineRef.current?.resize(w, h, { x: (w - rw) / 2, y: (h - rh) / 2, w: rw, h: rh });
    };
    const ro = new ResizeObserver(relayout);
    ro.observe(root);

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) engineRef.current?.setVisible(e.isIntersecting && !document.hidden);
    });
    io.observe(root);
    const onVis = () => engineRef.current?.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    const onMq = () => engineRef.current?.setOptions({ reducedMotion: mq.matches });
    mq.addEventListener?.("change", onMq);

    const pos = (e: PointerEvent) => {
      const b = root.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top] as const;
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = pos(e);
      const touch = e.pointerType === "touch";
      if (touch && e.buttons === 0 && e.pressure === 0) return;
      engineRef.current?.pointer("move", x, y, touch);
    };
    const onDown = (e: PointerEvent) => {
      const [x, y] = pos(e);
      engineRef.current?.pointer("down", x, y, e.pointerType === "touch");
    };
    const onUp = (e: PointerEvent) => {
      const [x, y] = pos(e);
      engineRef.current?.pointer("up", x, y, e.pointerType === "touch");
    };
    const onLeave = (e: PointerEvent) => {
      const [x, y] = pos(e);
      engineRef.current?.pointer("leave", x, y, e.pointerType === "touch");
    };
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerdown", onDown, { passive: true });
    root.addEventListener("pointerup", onUp, { passive: true });
    root.addEventListener("pointercancel", onUp, { passive: true });
    root.addEventListener("pointerleave", onLeave, { passive: true });

    relayout();
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener?.("change", onMq);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("pointerleave", onLeave);
      engineRef.current?.destroy();
      engineRef.current = null;
      canvas.remove();
      delete root.dataset.gl;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupDelay, density, strength, radius, dotSize, returnSpeed, liquid, ambient, ambientIntensity]);

  // Carrega a arte (1x por src, após o motor existir). Trocar o src refaz as
  // partículas com um dip rápido (data-swap) — a logo, que nunca troca, jamais pisca.
  React.useEffect(() => {
    const root = rootRef.current;
    const engine = engineRef.current;
    if (!root || !src || !engineReady) return;
    let cancelled = false;
    const swapping = root.dataset.gl === "on";
    if (swapping) root.dataset.swap = "1";
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      try {
        if (engine && root.dataset.gl !== "off") {
          engine.onFirstFrame = () => {
            if (cancelled) return;
            delete root.dataset.swap;
          };
          engine.setImage(image);
          // Upload é síncrono: acende sem depender do 1º rAF (cobre aba
          // oculta/throttle no load; o fade CSS suaviza a entrada).
          root.dataset.gl = "on";
        } else {
          root.dataset.gl = "off";
        }
      } catch {
        root.dataset.gl = "off";
      }
      if (!swapping) delete root.dataset.swap;
    };
    image.onerror = () => {
      delete root.dataset.swap;
      root.dataset.gl = "off";
    };
    image.src = src;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, engineReady]);

  // Palco decorativo: leitores de tela usam a live region + H1 real do hero.
  return (
    <div ref={rootRef} className={cn("lm-stage", className)} aria-hidden="true">
      {src ? <img className="lm-fallback" src={src} alt="" draggable={false} /> : null}
      <div ref={hostRef} className="lm-host" aria-hidden="true" />
    </div>
  );
}

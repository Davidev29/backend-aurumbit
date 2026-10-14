"use client";

import * as React from "react";
import { LiquidEngine, hexToRgb, type EngineOptions } from "./liquid-sculpture-hero";
import { cn } from "@/lib/utils";
import { WORD_H, WORD_W, paintWordPrefix, type WordArtTheme } from "@/lib/word-art";

/**
 * Palco do typing líquido — UMA interação só (digitar = liquefazer).
 *
 * - Canvas 2D persistente (1600×340) onde cada prefixo é desenhado e enviado
 *   ao motor via `setCanvas` SÍNCRONO: sem `toDataURL`/`Image`/decode, sem
 *   dip de opacidade, sem ordem trocada — cada tecla materializa-se já como
 *   partícula e reage ao cursor desde o 1º char (prefixo vazio = limpo).
 * - Física validada (legível digitando, reativa no hover): density 0.8,
 *   strength 1.0, radius 180, turbulence 0.7, returnSpeed 1.4, liquid 0.
 * - Sem fallback `<img>` no caminho de typing (piscaria por tecla); se o
 *   WebGL falhar, vira texto estático do prefixo atual.
 */

export interface LiquidTypeStageProps {
  /** Prefixo atual (string vazia = palco limpo). */
  text: string;
  /** Tamanho único medido para todas as palavras. */
  uni: number | null;
  theme: WordArtTheme;
  interactive?: boolean;
  /** Atraso da criação do motor pós-mount (escalona a partida). */
  startupDelay?: number;
  className?: string;
}

export function LiquidTypeStage({
  text,
  uni,
  theme,
  interactive = true,
  startupDelay = 0,
  className,
}: LiquidTypeStageProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const engineRef = React.useRef<LiquidEngine | null>(null);
  const drawRef = React.useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [engineReady, setEngineReady] = React.useState(false);
  const interactiveRef = React.useRef(interactive);
  React.useEffect(() => {
    interactiveRef.current = interactive;
    engineRef.current?.setOptions({ interactive });
  }, [interactive]);

  // Ciclo de vida do motor (1x).
  React.useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;

    if (!drawRef.current) {
      const c = document.createElement("canvas");
      c.width = WORD_W;
      c.height = WORD_H;
      drawRef.current = c;
    }

    const canvas = document.createElement("canvas");
    canvas.className = "lm-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fail = () => {
      root.dataset.gl = "off";
      setFailed(true);
    };
    let engine: LiquidEngine | null = null;
    const makeOpts = (rm: boolean): EngineOptions => ({
      interactive: interactiveRef.current,
      strength: 1.0,
      radius: 160,
      density: 0.8,
      dotSize: 1.15,
      spread: 1,
      turbulence: 0.7,
      liquid: 0,
      streaks: false,
      restStyle: "image",
      returnSpeed: 1.4,
      ambient: false,
      ambientIntensity: 1,
      speed: 1,
      intro: false,
      reducedMotion: rm,
      bg: hexToRgb("#090806", [0.035, 0.031, 0.024]),
      imgBg: null,
    });
    // Criação adiada: 1ª pintura primeiro, WebGL depois (escalonado).
    const timer = window.setTimeout(() => {
      try {
        engine = new LiquidEngine(canvas, makeOpts(mq.matches), fail);
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
      const ar = WORD_W / WORD_H;
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
  }, [startupDelay]);

  // Cada prefixo: desenha + upload síncrono (1ª pintura acende o palco).
  // Porta `engineReady`: antes do motor existir, só acumula estado.
  React.useEffect(() => {
    const root = rootRef.current;
    const engine = engineRef.current;
    const draw = drawRef.current;
    if (!root || !engine || !draw || uni == null) return;
    const ctx = draw.getContext("2d");
    if (!ctx) return;
    paintWordPrefix(ctx, text, uni, theme);
    try {
      engine.setCanvas(draw);
      if (root.dataset.gl !== "off") root.dataset.gl = "on";
    } catch {
      root.dataset.gl = "off";
      setFailed(true);
    }
  }, [text, uni, theme, engineReady]);

  return (
    <div ref={rootRef} className={cn("lm-stage", className)} aria-hidden="true">
      <div ref={hostRef} className="lm-host" aria-hidden="true" />
      {failed ? <p className="lm-type-fallback">{text}</p> : null}
    </div>
  );
}

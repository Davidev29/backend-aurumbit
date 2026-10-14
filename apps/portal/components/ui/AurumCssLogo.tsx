"use client";

import * as React from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Logomarca AurumBit desenhada em CSS puro — zero imagem, zero WebGL.
 *
 * Reproduz os dois ativos da marca (`/icon-192.png` = símbolo elo em pastilha
 * escura; `/logo-aurumbit.png` = wordmark "aurum bit" + subline "LABS &
 * STUDIOS ●●●●●●"):
 *
 * - `AurumMark`: pastilha escura (constante nos dois temas, como todo logo)
 *   com dois quadrados arredondados em gradiente ouro + ponte diagonal a 45°
 *   (mesmo gradiente nas 3 peças = junção invisível, como no PNG).
 * - `AurumWordmark`: "aurum bit" em `var(--font-display)` 600 com o mesmo
 *   gradiente bronze→champanhe dos SVGs líquidos + brilho vivo
 *   (`background-position`, só paint — sem `filter`).
 * - Subline com 6 pontos decrescentes em onda (como no PNG).
 *
 * Animações (só `transform`/`opacity`/`background-position`):
 * entrada com física (mola framer-motion) + flutuação da pastilha + respiro
 * da ponte + onda dos pontos + tilt 3D ao cursor. `prefers-reduced-motion`
 * desliga tudo (CSS em `globals.css` + `useReducedMotion` aqui).
 */

const EASE = [0.16, 1, 0.3, 1] as const;

export function AurumMark({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn(!reduce && "aurum-mark-float")}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.82, rotate: -10 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ duration: reduce ? 0.2 : 0.7, ease: EASE }}
    >
      <div className={cn("aurum-mark", className)} role="img" aria-label="Símbolo AurumBit">
        <span className="aurum-mark-tile aurum-mark-a" aria-hidden="true" />
        <span className="aurum-mark-bridge" aria-hidden="true" />
        <span className="aurum-mark-tile aurum-mark-b" aria-hidden="true" />
      </div>
    </motion.div>
  );
}

const WORD = "aurum bit";

export function AurumWordmark({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("aurum-word", className)} role="img" aria-label="aurum bit">
      {WORD.split("").map((ch, i) =>
        ch === " " ? (
          <span key={i} className="aurum-word-space" aria-hidden="true">
            {"\u00A0"}
          </span>
        ) : (
          <motion.span
            key={i}
            aria-hidden="true"
            className="aurum-word-letter"
            style={{ animationDelay: `${i * 0.35}s` }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: "0.35em" }}
            animate={{ opacity: 1, y: "0em" }}
            transition={{ duration: reduce ? 0.2 : 0.55, delay: 0.15 + i * 0.045, ease: EASE }}
          >
            {ch}
          </motion.span>
        )
      )}
    </div>
  );
}

const DOTS = [10, 9, 8, 7, 6, 5];

export function AurumSubline({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn("aurum-sub", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.6, delay: 0.55 }}
      aria-hidden="true"
    >
      <span className="aurum-sub-text">LABS &amp; STUDIOS</span>
      <span className="aurum-sub-dots">
        {DOTS.map((size, i) => (
          <span
            key={i}
            className="aurum-dot"
            style={{ width: size, height: size, animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </span>
    </motion.div>
  );
}

/**
 * Lockup completo + tilt 3D ao cursor (máx. 8°). O tilt é a "mão" da logo:
 * mexe na logo em si, não no fundo.
 */
export function AurumCssLogo({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [touched, setTouched] = React.useState(false);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 150, damping: 18 });
  const sry = useSpring(ry, { stiffness: 150, damping: 18 });

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry.set(px * 16);
    rx.set(-py * 16);
    if (!touched) setTouched(true);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <div className={cn("aurum-logo", className)}>
      <motion.div
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={reduce ? undefined : { rotateX: srx, rotateY: sry, transformPerspective: 1000 }}
        className="aurum-logo-tilt"
      >
        <AurumMark />
      </motion.div>
      <AurumWordmark />
      <AurumSubline />
      <p className="aurum-hint" data-touched={touched ? "1" : undefined} aria-hidden="true">
        <span className="aurum-hint-dot" />
        {touched ? "é a nossa marca, desenhada em CSS" : "passe o cursor pela logo"}
      </p>
    </div>
  );
}

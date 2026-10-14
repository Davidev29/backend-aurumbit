"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Palavras em efeito de digitação (typewriter) com dissolução orgânica.
 *
 * - Digita caractere a caractere com caret pulsante; segura; dissolve as
 *   letras em cascata rápida (stagger) e digita a próxima — nunca um
 *   "pisca" seco de troca.
 * - Letras em gradiente ouro vivo (reusa `.aurum-word-letter` + cascata de
 *   sheen por letra).
 * - `aria-hidden` no visual + região `sr-only` com `aria-live` que anuncia
 *   só a palavra completa (sem soletrar).
 * - `prefers-reduced-motion`: palavra cheia instantânea, sem caret pulsante.
 */

const TYPE_MS = 55;
const HOLD_MS = 2200;
const OUT_STAGGER_MS = 18;
const OUT_DURATION_MS = 320;
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Linha digitada (presentacional, controlada): letras em gradiente ouro com
 * entrada em cascata; com `leaving`, dissolvem subindo em cascata.
 */
export function TypedLine({
  text,
  leaving = false,
  wordKey = "w",
}: {
  text: string;
  leaving?: boolean;
  wordKey?: string;
}) {
  return (
    <>
      {text.split("").map((ch, i) => (
        <motion.span
          key={`${wordKey}-${i}`}
          className="aurum-word-letter"
          initial={{ opacity: 0, y: "0.35em" }}
          animate={leaving ? { opacity: 0, y: "-0.4em" } : { opacity: 1, y: "0em" }}
          transition={
            leaving
              ? { duration: 0.3, delay: i * (OUT_STAGGER_MS / 1000), ease: "easeIn" }
              : { duration: 0.38, ease: EASE }
          }
        >
          {ch === " " ? "\u00A0" : ch}
        </motion.span>
      ))}
    </>
  );
}

export function TypedWords({
  words,
  className,
}: {
  words: readonly string[];
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const [wi, setWi] = React.useState(0);
  const [chars, setChars] = React.useState(0);
  const [leaving, setLeaving] = React.useState(false);
  const [live, setLive] = React.useState(words[0]);
  const word = words[wi];

  React.useEffect(() => {
    if (reduce) {
      setChars(word.length);
      setLive(word);
      const id = window.setTimeout(() => setWi((i) => (i + 1) % words.length), 5000);
      return () => window.clearTimeout(id);
    }
    if (leaving) {
      const id = window.setTimeout(() => {
        setWi((i) => (i + 1) % words.length);
        setChars(0);
        setLeaving(false);
      }, word.length * OUT_STAGGER_MS + OUT_DURATION_MS);
      return () => window.clearTimeout(id);
    }
    if (chars < word.length) {
      const id = window.setTimeout(
        () => {
          const next = chars + 1;
          setChars(next);
          if (next === word.length) setLive(word);
        },
        chars === 0 ? 350 : TYPE_MS
      );
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setLeaving(true), HOLD_MS);
    return () => window.clearTimeout(id);
  }, [wi, chars, leaving, reduce, words, word]);

  return (
    <>
      <p className={cn("hero-typed", className)} aria-hidden="true">
        <TypedLine text={word.slice(0, chars)} wordKey={String(wi)} />
        <span className="type-caret" />
      </p>
      <span className="sr-only" aria-live="polite">
        {live}
      </span>
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTheme } from "next-themes";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThemeTransitionOrigin, runThemeTransition } from "@/lib/theme-transition";

/**
 * Toggle claro/escuro com micro-interação em duas frentes:
 * - Página: reveal circular a partir do botão (View Transitions) ou interpolação
 *   de tokens via `.theme-animating` — ver `lib/theme-transition.ts`.
 * - Ícone: Sol/Lua em crossfade com rotação+escala (só transform/opacity, roda
 *   no compositor). Sem JS ou antes de montar, ícone neutro (evita divergência).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  // Tema "compromissado" para a11y: durante a transição, aria reflete o tema
  // FINAL (não o intermediário do swap); limpo ao assentar.
  const [committed, setCommitted] = useState<"light" | "dark" | null>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const lockRef = useRef(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted ? (committed ? committed === "dark" : resolvedTheme !== "light") : true;

  const handleToggle = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (lockRef.current || !mounted) return;
      lockRef.current = true;
      const next = isDark ? "light" : "dark";
      setCommitted(next);
      const origin = getThemeTransitionOrigin(event.currentTarget);
      try {
        // flushSync garante que o novo tema entre no snapshot da View Transition.
        await runThemeTransition(
          () => {
            flushSync(() => setTheme(next));
          },
          { origin },
        );
      } finally {
        window.setTimeout(() => {
          lockRef.current = false;
          setCommitted(null);
        }, 120);
      }
    },
    [isDark, mounted, setTheme],
  );

  return (
    <button
      type="button"
      onClick={handleToggle}
      data-theme-toggle
      aria-pressed={mounted ? isDark : undefined}
      aria-label={isDark ? "Alternar para modo claro" : "Alternar para modo escuro"}
      title={isDark ? "Alternar para modo claro" : "Alternar para modo escuro"}
      className={cn(
        "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-base text-text2",
        "transition-[background-color,color,transform] duration-150 ease-out",
        "hover:bg-bg2 hover:text-accent active:scale-[0.88]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <Sun className="theme-toggle-icon" data-icon="sun" data-active={isDark} />
        <Moon className="theme-toggle-icon" data-icon="moon" data-active={!isDark} />
      </span>
    </button>
  );
}

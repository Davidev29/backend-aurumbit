"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "ab_theme";

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark"; // modo privado: default dark, só em memória
  }
}

/** Fonte de verdade: `data-theme` + classe `.dark` sempre sincronizados (DS §10). */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.setAttribute("data-theme", theme);
}

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "dark", toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  // DS §10: sem script inline (quebra prerender Next 14.2.5) — sincroniza no
  // mount a partir de ab_theme. Flash só p/ light, aceito.
  useEffect(() => {
    applyTheme(readStoredTheme());
    setTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme ]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  return useContext(ThemeCtx);
}

/**
 * Toggle canônico de tema. Troca instant (respeita reduced-motion: sem
 * crossfade) com `aria-pressed` + `aria-label` pt-BR. Toque ≥44px.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? "Alternar para tema claro" : "Alternar para tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      className={
        className ??
        "focus-ring flex h-11 w-11 items-center justify-center rounded-base border border-line2 text-text1"
      }
    >
      {isDark ? (
        <Sun size={20} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Moon size={20} strokeWidth={1.75} aria-hidden="true" />
      )}
    </button>
  );
}

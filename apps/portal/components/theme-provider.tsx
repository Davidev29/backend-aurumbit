"use client";

import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

/**
 * Espelha `data-theme` → classe `.dark`.
 * O Tailwind `dark:` agora resolve via `[data-theme="dark"]` (ver tailwind.config),
 * mas o CSS legado (`.dark .hero-base`, etc.) ainda espera a classe — o sync
 * via MutationObserver cobre troca por toggle, sistema e View Transitions.
 */
function ThemeClassSync() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      root.classList.toggle("dark", root.getAttribute("data-theme") === "dark");
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return null;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      storageKey="theme"
      themes={["light", "dark"]}
      // NÃO desabilitar: a interpolação é gerenciada por `lib/theme-transition`
      // (reveal circular via View Transitions + fallback `.theme-animating`).
      disableTransitionOnChange={false}
      {...props}
    >
      <ThemeClassSync />
      {children}
    </NextThemesProvider>
  );
}

/**
 * Fontes do Portal — fallback offline-first (sem next/font/google no build).
 * Em produção com rede, trocar por next/font/google (Sora/Space Grotesk,
 * Inter, Playfair Display itálico, JetBrains Mono) para zero layout shift.
 * Por ora usamos stacks do sistema (definidas em globals.css + tailwind).
 */

export const fontSans = { variable: "font-sans-fallback" };
export const fontDisplay = { variable: "font-display-fallback" };
export const fontAccent = { variable: "font-accent-fallback" };
export const fontMono = { variable: "font-mono-fallback" };

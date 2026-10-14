/** @type {import('tailwindcss').Config} */
const varColor = (name) => `var(--${name})`;

module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}", "./lib/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      // Cores 100% via var(--*) — light/dark trocam sem `dark:` (DS §10).
      // `dark:` só para diferenças estruturais. Nomes preservados (API pública do JSX).
      colors: {
        bg0: varColor("bg-0"),
        bg1: varColor("bg-1"),
        bg2: varColor("bg-2"),
        text1: varColor("text-1"),
        text2: varColor("text-2"),
        text3: varColor("text-3"), // SÓ decorativo — nunca texto funcional
        line1: varColor("border-1"),
        line2: varColor("border-2"),
        line3: varColor("border-3"),
        accent: { DEFAULT: varColor("accent"), strong: varColor("accent-strong") },
        accentink: varColor("accent-ink"),
        accentsoft: varColor("accent-soft"),
        danger: varColor("danger"),
        dangerink: varColor("danger-ink"),
        dangersoft: varColor("danger-soft"),
        ok: varColor("ok"),
        oksoft: varColor("ok-soft"),
        warn: varColor("warn"),
        warnsoft: varColor("warn-soft"),
        info: varColor("info"),
        infosoft: varColor("info-soft"),
      },
      // Stacks DS 02 §1 — zero webfont (offline-first, LGPD, sem FOUT).
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          '"Cascadia Mono"',
          '"JetBrains Mono"',
          "Consolas",
          "Menlo",
          "monospace",
        ],
      },
      // Pesos permitidos: 400/600/700 (+800 só logo). Sem 500.
      fontWeight: { normal: "400", semibold: "600", bold: "700", extrabold: "800" },
      fontSize: {
        "title-auth": ["1.35rem", { lineHeight: "1.3", fontWeight: "700" }],
        "title-page": ["1.25rem", { lineHeight: "1.3", fontWeight: "700" }],
        section: ["1.06rem", { lineHeight: "1.35", fontWeight: "700" }],
        headline: ["0.94rem", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["0.94rem", { lineHeight: "1.5", fontWeight: "400" }],
        callout: ["0.85rem", { lineHeight: "1.45", fontWeight: "400" }],
        caption: ["0.8rem", { lineHeight: "1.4", fontWeight: "400" }],
        micro: ["0.75rem", { lineHeight: "1.35", fontWeight: "600" }],
        kpi: ["1.6rem", { lineHeight: "1.2", fontWeight: "700" }],
        "mfa-code": ["1.4rem", { lineHeight: "1.3", fontWeight: "600" }],
      },
      // Raios travados por nível (DS §5): 8 pequeno, 10 base, 14 card, 18 modal.
      borderRadius: { sm: "8px", base: "10px", card: "14px", modal: "18px" },
      boxShadow: {
        1: varColor("shadow-1"),
        2: varColor("shadow-2"),
        3: varColor("shadow-3"),
      },
      // z-index canônico (DS §7) — espelha as CSS vars --z-*.
      zIndex: { chrome: "30", dropdown: "40", drawer: "46", modal: "50", tooltip: "70" },
      blur: { glass: "24px", card: "20px" },
      keyframes: {
        shimmer: { to: { backgroundPosition: "-200% 0" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-4px)" },
          "75%": { transform: "translateX(4px)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.2s infinite",
        "fade-in": "fade-in 160ms ease-out",
        shake: "shake 300ms ease-out",
      },
    },
  },
  plugins: [],
};

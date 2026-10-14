/** @type {import('tailwindcss').Config} */
const varColor = (name) => `var(--${name})`;

module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      // Cores 100% via var(--*) — dark tech + dourado premium
      colors: {
        bg0: varColor("bg-0"),
        bg1: varColor("bg-1"),
        bg2: varColor("bg-2"),
        text1: varColor("text-1"),
        text2: varColor("text-2"),
        text3: varColor("text-3"),
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
      // Fontes: Sora/Space Grotesk para títulos, Inter para corpo
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        accent: ["var(--font-accent)", "Georgia", "serif"],
      },
      fontWeight: {
        normal: "400",
        medium: "500",
        semibold: "600",
        bold: "700",
        extrabold: "800",
      },
      fontSize: {
        "title-auth": ["1.35rem", { lineHeight: "1.3", fontWeight: "700" }],
        "title-page": ["1.25rem", { lineHeight: "1.3", fontWeight: "700" }],
        headline: ["0.94rem", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["0.94rem", { lineHeight: "1.5", fontWeight: "400" }],
        callout: ["0.85rem", { lineHeight: "1.45", fontWeight: "400" }],
        caption: ["0.8rem", { lineHeight: "1.4", fontWeight: "400" }],
        micro: ["0.75rem", { lineHeight: "1.35", fontWeight: "600" }],
        kpi: ["1.6rem", { lineHeight: "1.2", fontWeight: "700" }],
        // Títulos de seção — sempre abaixo do H1 do hero (HIG craft)
        section: ["clamp(1.75rem, 4vw, 2.5rem)", { lineHeight: "1.15", fontWeight: "800" }],
        // Fluid hero headline
        "hero-sm": ["clamp(2rem, 5vw, 3rem)", { lineHeight: "1.15", fontWeight: "700" }],
        "hero-md": ["clamp(2.5rem, 6vw, 4rem)", { lineHeight: "1.1", fontWeight: "700" }],
        "hero-lg": ["clamp(3rem, 8vw, 5rem)", { lineHeight: "1.05", fontWeight: "700" }],
      },
      // Raios: 8 pequeno, 10 base, 14 card, 18 modal
      borderRadius: {
        sm: "8px",
        base: "10px",
        card: "14px",
        modal: "18px",
      },
      boxShadow: {
        1: varColor("shadow-1"),
        2: varColor("shadow-2"),
        3: varColor("shadow-3"),
        glow: "0 0 40px rgba(192,160,96,0.15)",
        "glow-sm": "0 0 20px rgba(192,160,96,0.1)",
        "glow-lg": "0 0 60px rgba(192,160,96,0.2)",
      },
      // z-index canônico
      zIndex: {
        chrome: "30",
        dropdown: "40",
        drawer: "46",
        modal: "50",
        tooltip: "70",
      },
      blur: {
        glass: "24px",
        card: "20px",
      },
      keyframes: {
        shimmer: { to: { backgroundPosition: "-200% 0" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(20px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "slide-down": { from: { opacity: "0", transform: "translateY(-20px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.95)" }, to: { opacity: "1", transform: "scale(1)" } },
        "underline": { from: { width: "0%" }, to: { width: "100%" } },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(192,160,96,0.1)" },
          "50%": { boxShadow: "0 0 40px rgba(192,160,96,0.25)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "drift": {
          "0%, 100%": { transform: "translate(0, 0)" },
          "25%": { transform: "translate(10px, -10px)" },
          "50%": { transform: "translate(-10px, 10px)" },
          "75%": { transform: "translate(10px, 10px)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.2s infinite",
        "fade-in": "fade-in 160ms ease-out",
        "slide-up": "slide-up 500ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slide-down 500ms cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 300ms cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "drift": "drift 20s ease-in-out infinite",
      },
      backgroundImage: {
        "gradient-gold": "linear-gradient(135deg, var(--gold-700) 0%, var(--gold-500) 50%, var(--gold-200) 100%)",
        "gradient-gold-radial": "radial-gradient(ellipse at center, rgba(192,160,96,0.15) 0%, transparent 70%)",
        "mesh-gradient": "linear-gradient(135deg, #0B0B0E 0%, #14141A 50%, #0B0B0E 100%)",
      },
    },
  },
  plugins: [],
};
# 07 — Arquitetura Tailwind · Aurum Bit Admin

> Papel deste doc: ARQUITETURA. Valores (hex, tempos, curvas) pertencem a `01-cores.md`, `02-tipografia.md`, `04-motion.md` — aqui só o mapeamento para `tailwind.config.js` + regras de convivência. Stack: Next.js 14, `tailwindcss@3` + PostCSS já instalados. `framer-motion` + `lucide-react` para motion/ícones (nada de animação via Tailwind além de transições utilitárias).
> Divergência resolvida: `01-cores.md` trava temas via `[data-theme="light"|"dark"]` no `<html>`; o setup Tailwind usa `darkMode:'class'` (`.dark`). Decisão: **CSS vars são a fonte de verdade; os dois seletores coexistem e são sincronizados pelo toggle (§3.1).** Classes semânticas (`bg-bg-1`, `text-text-1`…) trocam sozinhas via var — `dark:` só para diferenças estruturais (sombra, specular, bg de fallback).

---

## 1. `tailwind.config.js` completo proposto

Copiar para `apps/admin/tailwind.config.js`. Placeholder marcado `/* TODO consenso */` só onde outro especialista ainda não travou valor.

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class", // §3.1 — sincronizado com [data-theme] via ThemeScript
  theme: {
    // Breakpoints: default Tailwind, EXCETO md travado em 901px
    // para respeitar o corte sidebar/mobile já existente em globals.css
    // (max-width:900px esconde sidebar-desktop). /* TODO consenso: confirmar 901px vs 768px */
    screens: {
      sm: "640px",
      md: "901px",
      lg: "1200px", // = max-w do .shell-content atual
      xl: "1536px",
    },
    extend: {
      // ── 1.1 CORES SEMÂNTICAS: paleta fixa NÃO — sempre var() ──
      // Por quê var e não hex fixo: light/dark trocam sem `dark:` em cada uso;
      // valores exatos vivem em 01-cores.md (bloco canônico :root/[data-theme]).
      // Trade-off assumido: modificador de opacidade (`bg-accent/50`) NÃO funciona
      // com var() hex/rgba — usar os tokens `*-soft` já previstos para isso.
      colors: {
        bg: {
          0: "var(--bg-0)",
          1: "var(--bg-1)",
          2: "var(--bg-2)",
        },
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          solid: "var(--surface-solid)",
        },
        border: {
          subtle: "var(--border-subtle)",
          medium: "var(--border-medium)",
          strong: "var(--border-strong)",
        },
        text: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)", // SÓ decorativo (placeholder/caption) — nunca funcional
        },
        accent: {
          DEFAULT: "var(--accent)",       // marca/decorativo; texto funcional SÓ em dark
          strong: "var(--accent-strong)", // texto/ação com contraste nos 2 modos
          hover: "var(--accent-hover)",
          active: "var(--accent-active)",
          soft: "var(--accent-soft)",
        },
        onaccent: "var(--on-accent)", // texto sobre botão dourado
        danger: {
          DEFAULT: "var(--danger)",
          soft: "var(--danger-soft)",
          // Texto de erro sobre bg escuro: #ff9a9e (02-tipografia §3.4),
          // não --danger puro. Token abaixo evita hex solto no JSX.
          text: "var(--danger-text, #ff9a9e)", /* TODO consenso: mover --danger-text p/ 01-cores */
        },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
        focus: "var(--focus)",
        // Aliases legados (compat durante migração — proibir em código novo):
        // ink → text-1, textdim → text-2. Remover ao fim da migração (§2.4).
      },

      // ── 1.2 TIPOGRAFIA (fonte de verdade: 02-tipografia.md) ──
      fontFamily: {
        sans: [
          "system-ui", "-apple-system", "BlinkMacSystemFont",
          '"SF Pro Text"', '"SF Pro Display"', '"Segoe UI"',
          "Roboto", '"Helvetica Neue"', "Arial", "sans-serif",
        ],
        mono: [
          "ui-monospace", "SFMono-Regular", '"Cascadia Mono"',
          '"JetBrains Mono"', "Consolas", "Menlo", "monospace",
        ],
      },
      // Pesos permitidos: 400/600/700 + 800 SÓ no logo. Sem 500.
      fontWeight: { normal: "400", semibold: "600", bold: "700", extrabold: "800" },
      fontSize: {
        // token: [size, { lineHeight, letterSpacing, fontWeight }]
        "title-auth": ["1.35rem", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "700" }],
        "title-page": ["1.25rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "700" }],
        "title-section": ["1.0625rem", { lineHeight: "1.35", letterSpacing: "-0.005em", fontWeight: "700" }],
        headline: ["0.9375rem", { lineHeight: "1.45", letterSpacing: "0", fontWeight: "600" }],
        body: ["0.9375rem", { lineHeight: "1.5", letterSpacing: "0", fontWeight: "400" }],
        callout: ["0.85rem", { lineHeight: "1.5", letterSpacing: "0", fontWeight: "400" }],
        caption: ["0.8rem", { lineHeight: "1.45", letterSpacing: "0.01em", fontWeight: "400" }],
        micro: ["0.78rem", { lineHeight: "1.4", letterSpacing: "0.02em", fontWeight: "600" }], // SÓ badge; piso 12.5px
        "kpi-currency": ["1.6rem", { lineHeight: "1.2", letterSpacing: "0", fontWeight: "700" }], // + font-mono + tabular-nums
        "kpi-number": ["1.6rem", { lineHeight: "1.2", letterSpacing: "0", fontWeight: "700" }],   // sans + tabular-nums
        "code-mfa": ["1.4rem", { lineHeight: "1.3", letterSpacing: "0.5em", fontWeight: "600" }], // + font-mono, indent 0.5em
        brand: ["1.05rem", { lineHeight: "1.2", letterSpacing: "0.02em", fontWeight: "800" }],     // 800 SÓ aqui
        "brand-sub": ["0.82rem", { lineHeight: "1.4", letterSpacing: "0", fontWeight: "400" }],
      },

      // ── 1.3 RAIOS (01 §4 — travado por nível, sem invenção) ──
      borderRadius: {
        sm: "8px",    // badge, input, masked-json, btn
        DEFAULT: "10px", // legado --radius; usar só em compat
        md: "10px",   // dropdown, tooltip, menu
        lg: "14px",   // card, KPI
        xl: "18px",   // modal, sheet, dialog
        "auth-logo": "12px",
      },

      // ── 1.4 SOMBRAS (valores de 01 §4; light/dark via vars) ──
      boxShadow: {
        card: "var(--shadow-card)",     // dark: specular + 0 8px 24px rgba(0,0,0,.25) / light: …rgba(15,17,21,.08)
        modal: "var(--shadow-modal)",   // … + 0 24px 64px rgba(0,0,0,.45)
        "auth-logo": "0 4px 18px rgba(232,179,75,0.35)",
        "auth-card": "0 12px 40px rgba(0,0,0,0.45)",
        "qr-frame": "0 6px 24px rgba(0,0,0,0.5)",
        /* TODO consenso (01): publicar --shadow-card/--shadow-modal/--specular no bloco canônico */
      },

      // ── 1.5 BLURS (Liquid Glass — 01 §4/§5) ──
      backdropBlur: {
        card: "20px",   // E1 card/KPI (sempre + saturate-140)
        chrome: "24px", // E4 sidebar/topbar (sempre + saturate-150…160)
        modal: "30px",  // E3 modal/sheet (sempre + saturate-150 + scrim)
        scrim: "8px",   // backdrop do overlay (04-motion §1.5)
      },
      backdropSaturate: { 140: "1.4", 150: "1.5", 160: "1.6" },

      // ── 1.6 ESPAÇAMENTOS/LARGURAS ──
      // spacing: default Tailwind (não estender — regra §3.3).
      // Só larguras de chrome + conteúdo, que hoje são vars/mágicos:
      width: { sidebar: "18rem", "sidebar-collapsed": "4rem" },
      maxWidth: { content: "75rem", auth: "25rem", dialog: "36rem", drawer: "20rem" },

      // ── 1.7 ANIMAÇÕES/KEYFRAMES PERMITIDOS ──
      // Motion real (modal/drawer/toast/página) = framer-motion via lib/motion.ts (04-motion).
      // Aqui SÓ: shimmer de skeleton, fade utilitário, shake de erro — transform/opacity apenas.
      // PROIBIDO adicionar bounce/spring via Tailwind; PROIBIDO animar backdrop-filter/width/blur.
      transitionDuration: { instant: "100ms", fast: "160ms", medium: "240ms", slow: "360ms" },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16,1,0.3,1)",     // default de entrada
        "in-out": "cubic-bezier(0.4,0,0.2,1)", // troca de estado visível
        in: "cubic-bezier(0.4,0,1,1)",         // SÓ saída/exit
      },
      keyframes: {
        shimmer: { to: { backgroundPosition: "-200% 0" } }, // skeleton (único infinite além de spinner)
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } }, // skeleton→conteúdo (crossfade 240ms)
        shake: { // erro form/MFA: 4px, 300ms, 2 ciclos (04 §4)
          "0%,100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-4px)" },
          "50%": { transform: "translateX(4px)" },
          "75%": { transform: "translateX(-4px)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.2s linear infinite",
        "fade-in": "fade-in 240ms cubic-bezier(0.4,0,0.2,1)",
        shake: "shake 300ms cubic-bezier(0.4,0,0.2,1)",
      },
    },
  },
  plugins: [],
};
```

Notas de leitura do config:
- `colors.ink` atual (placeholder `#e8eaf0`) MORRE — substituído por `text-1/2/3`.
- `fontSize` carrega peso/leading/tracking juntos: `text-headline`, `text-body` etc. já saem com hierarquia correta (02: hierarquia por peso+tamanho, nunca só cor).
- `kpi-currency`/`code-mfa` exigem `font-mono` + `tabular-nums` no className (ver §4) — o config não injeta família sozinho.
- `backdropBlur` sem `saturate` é bug visual (01 §4): todo uso de `backdrop-blur-card/chrome/modal` acompanha `backdrop-saturate-140/150/160`.

---

## 2. Migração do `globals.css` legado (719 linhas auditadas)

### 2.1 O que vira token (some do CSS, vira classe utilitária no JSX)

| Legado (`:root` / regra) | Vira |
|---|---|
| `--bg/--bg-soft/--bg-softer/--border/--text/--text-dim/--accent/--accent-ink/--danger/--ok/--warn/--radius` | Bloco canônico de 01-cores (`--bg-0…--focus`) + `theme.colors` acima. Aliases de compat: `--bg: var(--bg-1); --bg-soft: var(--surface-solid); --bg-softer: var(--bg-2); --border: var(--border-medium); --text: var(--text-1); --text-dim: var(--text-2); --accent-ink: var(--on-accent); --ok: var(--success); --warn: var(--warning); --radius: 10px;` — remover ao fim (§2.4) |
| `body {15px, lh 1.5, system-ui}` | `@layer base` (ver 2.2) + `text-body font-sans` onde relevante |
| `.kpi-value 1.6rem/700`, `.kpi-label 0.85rem`, `.badge 0.78rem/600`, `table.data 0.92rem→body`, `th 600 dim`, `.auth-card h1 1.35rem`, `.code-input 1.4rem/0.5em`, `.input-lg/.btn-lg 1rem`, `.password-toggle/.auth-foot 0.8rem`, `.manual-key summary 0.88rem` | `fontSize` tokens §1.2 (mapeamento exato em 02 §4). `td` sobe de 0.92rem para `text-body` |
| `.card` fundo/borda/raio/padding, `.btn/.btn-primary/.btn-danger/.btn-icon`, `.input/.select`, `.badge*`, `.table-wrap + table.data`, `.tabs/.tab`, `.menu`, `.segmented`, `.dialog/.dialog-overlay`, `.drawer/.drawer-overlay`, `.auth-*`, `.qr-frame`, `.masked-json`, `.trace-steps`, `.dot*`, `.feedback`, `.skeleton + @keyframes shimmer` | `@layer components` intermediário (2.2) e depois classes utilitárias nos componentes §4; badges de papel/fatura viram variantes do componente Badge |
| `.shell/.shell-main/.shell-content/.sidebar/.topbar/.toolbar/.dialog-actions/.reveal-row/.key-row/.auth-wrap/.auth-brand/.password-wrap` | Utilitários Tailwind inline nos layouts (`flex min-h-screen`, `w-sidebar`, `max-w-content` etc.) — layout não merece componente CSS |

### 2.2 O que vira `@layer base` / `@layer components` (novo `globals.css`)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root, [data-theme="dark"] { /* bloco canônico 01-cores §3 (dark default) */ }
  [data-theme="light"] { /* bloco canônico 01-cores §3 */ }
  .dark { /* vazio intencional: darkMode:'class' precisa da classe no <html>;
             vars vêm do [data-theme] sincronizado — ver §3.1 */ }
  html { font-size: 16px; -webkit-text-size-adjust: 100%; }
  body { @apply bg-bg-1 text-text-1 font-sans text-body antialiased; }
  a { @apply text-accent-strong dark:text-accent; } /* light: strong (contraste); dark: accent */
  :focus-visible { outline: none; box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 4px var(--focus); }
  ::selection { background: var(--accent-soft); }
  .mono, td[data-numeric], .kpi-value[data-kind="currency"] {
    font-variant-numeric: tabular-nums lining-nums;
    font-feature-settings: "tnum" 1, "lnum" 1;
  }
  @supports not (backdrop-filter: blur(1px)) {
    .glass { background: var(--surface-solid) !important; }
  }
  @media (prefers-reduced-transparency: reduce) {
    .glass { background: var(--surface-solid) !important; backdrop-filter: none !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .animate-shimmer, .animate-shake { animation: none !important; }
  }
  .truncate-1 { @apply truncate; } /* canônico p/ nav/células (02 §3.1) */
}

/* @layer components: APENAS shims de compat com o legado durante a migração.
   Regra: nenhum componente NOVO nasce aqui; todo shim tem `/* LEGADO — migrar p/ <Classe> *\/`
   e é deletado em §2.4. Ex.: .btn, .card, .input, .badge, .table-wrap, .tabs, .menu,
   .dialog, .drawer, .auth-*, .skeleton — corpo = @apply das utilitárias equivalentes. */
```

Mantém-se em CSS puro (fora de layers): `.skip-link`, `@keyframes` do config (gerados pelo Tailwind), `color-scheme` por tema, `white-space: pre-wrap` do `masked-json` (via `whitespace-pre-wrap break-words` no JSX resolve — sem classe própria).

### 2.3 O que MORRE (deletar, sem substituto)

1. Tamanhos órfãos: `0.88/0.92/1rem` de summary/td/input-lg, `1.05rem` solto (02: viram `callout/body/brand`).
2. Cores hard-coded: `#fff` do `.qr-frame` (vira token fixo `qr-frame: #FFFFFF` se consenso quiser — QR precisa fundo branco real nos 2 modos), `#8ec5ff/#d3a0fa/#7dd68f/#ff9a9e` soltos nos badges (viram `info/success/danger-text`), `rgba(0,0,0,.6)` duplicado (vira token `--scrim`), gradiente `radial-gradient` do `.auth-wrap` fora de token.
3. `transition: width .15s` da sidebar (04 §3.1: nunca animar width — collapse vira instant ou `x`/clip).
4. `font: inherit` espalhado (herança já resolve com `font-sans` no body).
5. `table.data thead th` com hierarquia só por cor (02: `th` = `text-headline` 600 + `text-text-2`).

### 2.4 Convivência sem quebrar o resto (ordem travada)

1. **Fase 0 — fundação (1 PR):** publicar bloco canônico 01 + aliases legados + `@layer base` + `ThemeScript` (§3.1) + `lib/cn.ts` (§3.2). Nenhum JSX muda. Critério: `next build` + screenshot auth/app idênticos.
2. **Fase 1 — auth primeiro (login/MFA/forbidden + `AuthLayout`):** auth é isolada (sem sidebar/shell), tem o maior valor visual (gradiente + logo + code-input) e o menor blast radius. Reescrever `auth-wrap/auth-card/field/input/btn` com utilitárias + componentes §4. Legado `.auth-*` vira shim `@apply` apontando p/ novo visual (quem ainda usa `.auth-*` herda o novo sem quebrar).
3. **Fase 2 — átomos (`components/ui`: Button, Input, GlassCard, Badge, Skeleton, Feedback):** páginas passam a importar átomos; classes `.btn/.card/.input/.badge/.skeleton` viram shims `@apply` dos átomos.
4. **Fase 3 — shell (Sidebar/Topbar/Drawer/Menu/Tabs/Table):** por último, porque toca todas as rotas `(app)`.
5. **Fase 4 — limpeza:** deletar shims + aliases + `colors.ink`; ligar a fiscalização (§3.3) como erro de CI. Critério de done: `grep -r "class=\"(btn|card|input|badge|table-wrap|auth-)\\b" apps/admin/{app,components}` retorna zero (fora de `globals.css`).

---

## 3. Convenções travadas

### 3.1 Dark mode: classe `.dark` + `[data-theme]` sincronizados, persistência, anti-FOUC

- Fonte de verdade do TEMA: `document.documentElement.dataset.theme` (`"dark"|"light"`, default `"dark"`) + classe `.dark` espelhada (Tailwind exige a classe; vars exigem o atributo). Nunca setar um sem o outro.
- Persistência: `localStorage["aurum-theme"]`. Opcional (fase 3 shell): cookie `aurum-theme` p/ SSR sem flash — hoje sem SSR de tema, Flash aceitável só com script inline.
- Anti-FOUC obrigatório em `app/layout.tsx`: inline `<script>` ANTES de qualquer CSS que lê `localStorage` (try/catch p/ modo privado) e aplica `data-theme` + `.dark` na `<html>`. Sem isso o primeiro paint pisca light.
- Toggle (Header/AccountMenu, ícone `lucide-react` `Sun/Moon`): client component que alterna, persiste e respeita `prefers-reduced-motion` (troca instant, sem crossfade — 04 §3.2). `aria-pressed` + `aria-label` ("Alternar para modo claro/escuro").
- `color-scheme: dark/light` acompanha o tema (inputs nativos/scrollbar certos).

```tsx
// app/layout.tsx — esqueleto (classes exatas do <html>/<body>)
<html lang="pt-BR" suppressHydrationWarning>
  <head>{/* ThemeScript inline: lê localStorage["aurum-theme"] || "dark",
           seta documentElement.dataset.theme + classList.toggle("dark") */}</head>
  <body className="bg-bg-1 text-text-1 font-sans text-body antialiased">
    <a href="#conteudo" className="absolute -left-[9999px] top-0 z-[100] rounded-br-lg bg-accent px-4 py-2 font-semibold text-onaccent focus:left-0">
      Pular para o conteúdo
    </a>
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  </body>
</html>
```

### 3.2 `cn()` helper: SIM, instalar `clsx` + `tailwind-merge`

- **Justificativa:** `clsx` sozinho concatena mas não resolve conflito (`"px-4 px-6"` mantém os dois — vence o CSS, não a intenção). Componentes com variantes (Button/Input/Badge §4) precisam que `className` do chamador SOBRESCREVA o default — isso é `tailwind-merge`. Sem ele, cada `className` custom vira bug de especificidade.
- **Instalação:** `pnpm --filter @aurum/admin add clsx tailwind-merge` (`clsx` hoje só existe como transitivo — `package-lock/package.json` mostra `clsx@2.1.1` via outra dep; depender de transitivo quebra no próximo prune).
- **Helper canônico** (`lib/cn.ts`, única importação permitida):
  ```ts
  import { clsx, type ClassValue } from "clsx";
  import { twMerge } from "tailwind-merge";
  export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
  ```
- **Configuração obrigatória do `tailwind-merge`:** registrar os tokens custom como grupos de conflito (senão `text-title-page` vs `text-body` não fazem merge):
  ```ts
  import { extendTailwindMerge } from "tailwind-merge";
  export const twMergeAurum = extendTailwindMerge({
    extend: { textStyle: ["title-auth","title-page","title-section","headline","body","callout","caption","micro","kpi-currency","kpi-number","code-mfa","brand","brand-sub"] },
  });
  ```
  /* TODO consenso: validar lista contra API de custom groups da versão instalada; alternativa aceitável: evitar dois text-* no mesmo cn() por convenção + lint. */

### 3.3 Nada de valores arbitrários fora dos tokens — regra + fiscalização

- **Regra:** proibido `bg-[#...]`, `text-[13px]`, `w-[220px]`, `shadow-[...]`, `blur-[...]`, `rounded-[...]` no `app/` e `components/`. Exceções taxativas (comentar `/* exceção-token: motivo */`): (a) `z-[100]` do skip-link e layers de overlay; (b) `-left-[9999px]` do skip-link; (c) `w-[200px]` do QR (tamanho físico do código); (d) `top-[calc(100%+6px)]` de menu até virar token. Todo o resto usa token (§1).
- **Fiscalização (3 camadas):**
  1. **ESLint (erro, bloqueia PR):** `eslint-plugin-tailwindcss` com `no-arbitrary-value: error` + allowlist das 4 exceções acima. /* TODO consenso: aprovar plugin + allowlist */
  2. **CI grep (erro):** `grep -rEn "(bg|text|border|w|h|p[xy]?|m[xy]?|rounded|shadow|blur)-\[|/(50|75)\b" apps/admin/{app,components,lib} --include='*.tsx' --include='*.ts'` deve retornar zero (o `/(50|75)` pega modificador de opacidade, que não funciona com `var()` — usar `*-soft`).
  3. **Revisão humana:** `text-text-3` em texto funcional e `backdrop-blur-*` sem `backdrop-saturate-*` são rejeição automática (01 §5 + 02 §3.4).

---

## 4. Exemplo de 3 componentes (classes exatas, Tailwind + `cn`)

> Princípios aplicados: `backdrop-blur-*` sempre + `backdrop-saturate-*` + fallback `.glass` (01 §4); inputs SEMPRE opacos (01 §5); `tabular-nums` no financeiro (02 §3.2); motion via `framer-motion` (`whileTap/whileHover`), nunca transição Tailwind em `backdrop-filter` (04 §3.1); ícones `lucide-react` 16–18px nos inputs/botões.

### 4.1 `GlassCard` (`components/ui/glass-card.tsx`)

```tsx
import { cn } from "@/lib/cn";

export function GlassCard({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={cn(
        // E1 card: surface-1 + blur 20 + saturate + borda sutil + sombra de elevação + raio card 14px
        "glass rounded-lg border border-border-subtle bg-surface-1",
        "backdrop-blur-card backdrop-saturate-140 shadow-card",
        "p-4 md:p-5", // padding escala no breakpoint travado (901px)
        className,
      )}
    >
      {children}
    </section>
  );
}
// Título do card: <h2 className="text-title-section text-text-1">…</h2>
// Meta/descrição: <p className="text-callout text-text-2">…</p>
// KPI monetário:  <p data-kind="currency" className="font-mono text-kpi-currency tabular-nums text-text-1">R$ …</p>
// KPI contável:   <p className="text-kpi-number tabular-nums text-text-1">…</p>
// Faixa de destaque KPI: "border-l-[3px]" PROIBIDO — usar `border-l-4 border-accent` + fundo `bg-accent-soft` (tokens).
```

### 4.2 `Button` (`components/ui/button.tsx`)

```tsx
import { m } from "framer-motion"; // LazyMotion domAnimation no root (04 §4)
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const variants = {
  primary: "border border-transparent bg-accent font-semibold text-onaccent hover:bg-accent-hover active:bg-accent-active",
  secondary: "border border-border-medium bg-transparent text-text-1 hover:border-border-strong hover:bg-border-subtle",
  danger: "border border-danger bg-transparent font-semibold text-danger-text hover:border-danger-text",
  ghost: "border border-transparent text-text-1 hover:bg-border-subtle",
  subtleDanger: "border border-transparent bg-danger-soft font-semibold text-danger hover:bg-border-subtle",
};
const sizes = {
  md: "h-9 gap-2 px-4 text-headline",   // padrão (auth usa lg)
  lg: "h-11 gap-2 px-5 text-body",      // .btn-lg: cresce por padding/altura, NÃO por step de fonte (02)
  icon: "h-9 w-9 p-0",                 // .btn-icon
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: any) {
  return (
    <m.button
      whileTap={{ scale: 0.97 }} whileHover={{ y: -1 }} // 04 §2.7 — shadow troca instant, sem animar
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm",
        "transition-colors duration-instant ease-out", // SÓ cor; nunca transform/blur aqui
        "focus-visible:shadow-[0_0_0_2px_var(--bg-1),0_0_0_4px_var(--focus)] focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-45", // 0.45 = .btn:disabled legado
        variants[variant], sizes[size], className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
      {children}
    </m.button>
  );
}
// Primário no footer de modal à direita (HIG, 01 §6); loading mantém largura do label (spinner inline, sem layout shift).
```

### 4.3 `Input` (`components/ui/input.tsx`)

```tsx
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";

export function Field({ label, hint, error, children }: any) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-headline text-text-1">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-callout text-text-2">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-body text-danger-text">{error}</p>}
    </div>
  );
}

export function Input({ error, mono, numeric, className, ...rest }: any) {
  return (
    <input
      aria-invalid={!!error}
      {...rest}
      className={cn(
        // OPACO sempre (01 §5): bg-surface-solid, sem blur. Valor text-1, placeholder text-3.
        "h-9 w-full rounded-sm border bg-surface-solid px-3 text-body text-text-1",
        "placeholder:text-callout placeholder:text-text-3",
        "border-border-medium hover:border-border-strong",
        "focus:border-accent-strong focus:shadow-[0_0_0_2px_var(--bg-1),0_0_0_4px_var(--focus)] focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-45",
        error && "border-danger focus:border-danger focus:shadow-[0_0_0_2px_var(--bg-1),0_0_0_4px_var(--danger)]",
        mono && "font-mono",
        numeric && "text-right tabular-nums", // monetário em tabela/KPI: right + tnum (02 §3.2)
        className,
      )}
    />
  );
}

export function PasswordInput(props: any) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-14" />
      <button type="button" onClick={() => setShow((s) => !s)}
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm px-2 py-1 text-caption text-text-2 hover:text-text-1">
        {show ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function CodeInput(props: any) { // MFA: único tracking largo permitido
  return <Input {...props} inputMode="numeric" autoComplete="one-time-code"
    className="h-auto py-3 text-center font-mono text-code-mfa tabular-nums [text-indent:0.5em]" />;
  // ^ `[text-indent:0.5em]` é a 5ª exceção arbitrária (centraliza glyphs com tracking 0.5em — 02).
  // Erro de MFA: borda danger + <m.span> shake 300ms (04 §2.10) + foco volta ao box 1, sem toast.
}
```

---

## Apêndice — checklist de aceite desta arquitetura

- [ ] `tailwind.config.js` §1 aplicado; `next build` verde; nenhum `dark:` em cor semântica (só estrutural).
- [ ] `globals.css` com `@tailwind` + `@layer base` §2.2; bloco 01 colado sem edição; aliases legados presentes.
- [ ] Auth reescrita em utilitárias (§2.4 Fase 1) pixel-igual; resto da app intacto (shims).
- [ ] `ThemeScript` anti-FOUC + toggle persistido + `suppressHydrationWarning` (§3.1).
- [ ] `clsx` + `tailwind-merge` dependências diretas; `lib/cn.ts` único merge (§3.2).
- [ ] ESLint `no-arbitrary-value` + CI grep verdes; 4–5 exceções comentadas (§3.3).
- [ ] `GlassCard/Button/Input` §4 criados; páginas auth os usam; `backdrop-blur-*` sempre com `saturate`; input sem blur; `tabular-nums` no financeiro.

# 04 — Motion / Microinterações — Aurum Bit Admin Terminal

> Stack: Next.js 14 + `framer-motion` (v11+). Princípio Apple HIG: movimento com propósito — orienta atenção, confirma ação, nunca decora. 60fps sempre (só `transform` + `opacity`).

---

## 1. Tokens de motion (travados — não inventar valores ad-hoc)

### 1.1 Durações

| Token | Valor | Uso |
|---|---|---|
| `motion.instant` | `100ms` | Toggle, checkbox, pressionar botão (`whileTap`), cursor/foco, hover de ícone |
| `motion.fast` | `160ms` | Dropdown, tooltip, popover, underline de tab, QR aparecendo, badge count |
| `motion.medium` | `240ms` | Modal, drawer, toast entrada, transição de página, skeleton→conteúdo, MFA auto-submit |
| `motion.slow` | `360ms` | Onboarding/wizard step, empty-state ilustrado, layout shift grande (sidebar collapse). NUNCA acima de 400ms no terminal |

Regra: saídas são 25% mais rápidas que entradas (`exit = enter × 0.75`). Toast sai em 180ms, modal sai em 180ms.

### 1.2 Easings (cubic-bezier — default, sem spring)

| Token | Curva | Uso |
|---|---|---|
| `ease.out` | `cubic-bezier(0.16, 1, 0.3, 1)` | **DEFAULT de entrada.** Modal, drawer, dropdown, toast, página. Desacelera no fim = sensação Apple |
| `ease.in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Transição entre dois estados visíveis (tab switch, theme, skeleton→conteúdo crossfade) |
| `ease.in` | `cubic-bezier(0.4, 0, 1, 1)` | **SÓ para saída/exit.** Nunca para entrada |
| `ease.linear` | `linear` | Progress / spinner / shimmer do skeleton. Nada else |

### 1.3 Quando usar spring (framer-motion) — exceção, não regra

Spring SÓ em 3 casos: **toggle/switch knob, drag-to-dismiss (drawer/toast), pressionar botão (whileTap)**. Todo o resto = tween com `ease.out`.

| Caso | Parâmetros exatos |
|---|---|
| Toggle knob / switch | `type: "spring", stiffness: 500, damping: 32` (sem bounce, assentamento rápido) |
| `whileTap` botão | `type: "spring", stiffness: 700, damping: 30` (resposta tátil) |
| Drag-to-dismiss (drawer, toast mobile) | `type: "spring", stiffness: 300, damping: 30` (segue o dedo, solta com física) |
| Toast entrada desktop | NÃO usar spring — tween `ease.out 240ms` (spring em toast = amador) |

Proibido: `bounce`, `stiffness < 200`, spring em modal/dropdown/página.

### 1.4 Distâncias de deslocamento

| Token | Valor | Uso |
|---|---|---|
| `shift.xs` | `4px` | Hover lift de botão/card, nudge de erro (shake usa 4px), tooltip |
| `shift.sm` | `8px` | Dropdown (y: 8→0), toast (y: 8→0), badge |
| `shift.md` | `16px` | Modal (y: 16→0), transição de página (y: 16→0), QR (y: 8→0 + scale) |
| `shift.lg` | `320px` | Drawer lateral (x: 320→0 = largura do drawer; animar `x`, não `width`) |

Nunca deslocar >16px em eixo Y para elementos que aparecem (parece barato). Drawer/modal sempre combinam deslocamento + fade.

### 1.5 Escala e blur

| Token | Valor | Uso |
|---|---|---|
| `scale.modal` | `0.96 → 1` | Entrada de modal (combinado com fade + y 16px) |
| `scale.press` | `0.97` | `whileTap` em botões primários; `0.98` em cards clicáveis |
| `scale.pop` | `0.9 → 1` | QR code, avatar upload preview, badge novo |
| `blur.modal` | `backdrop blur 8px`, fade 160ms | Backdrop de modal/drawer. Blur anima só opacidade do layer, nunca o valor do blur |

---

## 2. Padrões por componente (framer-motion)

> Todos os exemplos usam as variantes reutilizáveis da §4. Import: `import { m, AnimatePresence } from "framer-motion"` (usar `m` + `LazyMotion` com `domAnimation` para bundle menor).

### 2.1 Entrada de modal (scale + fade + y)

```tsx
<AnimatePresence>
  {open && (
    <m.div className="backdrop" variants={backdrop} initial="hidden" animate="show" exit="exit" />
    <m.div role="dialog" aria-modal variants={fadeScale} initial="hidden" animate="show" exit="exit"
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </m.div>
  )}
</AnimatePresence>
// fadeScale: hidden {opacity 0, scale .96, y 16} → show {opacity 1, scale 1, y 0}
// exit: 180ms ease.in. Backdrop: fade 160ms. ESC fecha, foco vai ao primeiro campo.
```

### 2.2 Drawer lateral (slideOver)

```tsx
<AnimatePresence>
  {open && (
    <m.aside variants={slideOver} initial="hidden" animate="show" exit="exit"
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      drag="x" dragConstraints={{ left: 0 }} dragElastic={0.2}
      onDragEnd={(_, i) => i.offset.x > 120 && onClose()}>
      {children}
    </m.aside>
  )}
</AnimatePresence>
// hidden {x: 320, opacity 0} → show {x: 0, opacity 1}. Animar x (transform), NUNCA width.
// Mobile: drawer vira bottom-sheet (y em vez de x, drag="y").
```

### 2.3 Dropdown / popover / menu

```tsx
<m.div variants={fadeShift} initial="hidden" animate="show" exit="exit"
  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}>
  {/* hidden {opacity 0, y 8, scale .98} → show {opacity 1, y 0, scale 1} */}
  {/* transform-origin: top para menu abaixo do trigger, bottom se abre para cima */}
</m.div>
// 160ms, sem spring, sem stagger. Fecha em 120ms. Item hover = bg instant 100ms, sem slide.
```

### 2.4 Toast

```tsx
<m.div layout={false} initial={{ opacity: 0, y: 8, scale: 0.98 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  exit={{ opacity: 0, y: 4, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}>
  {/* auto-dismiss 5s (erro: fica até dispensar). Empilha max 3, novos em cima, antigos saem por baixo */}
</m.div>
// NUNCA layout animation em toast. Progress de auto-dismiss = barra linear 5s (único linear permitido).
```

### 2.5 Transição de página (App Router)

```tsx
// app/template.tsx — fade + rise sutil, SEM slide lateral (terminal ≠ site marketing)
<m.main variants={pageTransition} initial="hidden" animate="show"
  transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}>
  {children}
</m.main>
// pageTransition: hidden {opacity 0, y 16} → show {opacity 1, y 0}.
// Sem AnimatePresence entre rotas (evita flash). Tabelas: página troca instant, só o conteúdo faz stagger.
```

### 2.6 Skeleton → conteúdo

```tsx
{loading ? <Skeleton /> : (
  <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}>
    {content}
  </m.div>
)}
// Crossfade 240ms ease.in-out. Skeleton shimmer = linear 1.2s infinite (único infinite permitido além de spinner).
// Tabelas/listas usam staggerList (abaixo). Nunca "pop" em conteúdo carregado.
```

### 2.7 Pressionar botão (whileTap) + hover lift

```tsx
<m.button whileTap={{ scale: 0.97 }} whileHover={{ y: -1 }}
  transition={{ type: "spring", stiffness: 700, damping: 30 }}>
  {/* hover lift: y -1px + shadow cresce (shadow NÃO anima — troca instant no hover) */}
  {/* disabled: sem whileTap/whileHover. Loading: spinner 16px dentro, label mantém largura */}
</m.button>
// Cards clicáveis: whileTap 0.98, hover y -2px + border highlight. Nunca scale >1 no hover (parece brinquedo).
```

### 2.8 Toggle / switch

```tsx
<m.button role="switch" aria-checked={on} onClick={toggle}
  transition={{ duration: 0.1 }} style={{ background: on ? green : zinc }}>
  <m.span layout={false} animate={{ x: on ? 16 : 0 }}
    transition={{ type: "spring", stiffness: 500, damping: 32 }} />
</m.button>
// Track: cor instant 100ms. Knob: spring 500/32. Único spring "decorativo" permitido. Respeita reduced-motion → vira instant.
```

### 2.9 QR code aparecendo (2FA / depósito)

```tsx
<m.div variants={popIn} initial="hidden" animate="show"
  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}>
  {/* popIn: hidden {opacity 0, scale .9, y 8} → show {opacity 1, scale 1, y 0} */}
  {/* QR nunca faz shimmer/skeleton — placeholder = box com ícone, depois pop 160ms */}
</m.div>
```

### 2.10 Código MFA auto-submit

```tsx
// 6 boxes. Cada dígito: pop 100ms (scale .9→1). Completo: shake? NÃO — borda verde 100ms + submit imediato.
<m.span key={`${i}-${digit}`} initial={{ scale: 0.9, opacity: 0.5 }}
  animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.1 }}>
  {digit}
</m.span>
// Erro: shake horizontal 4px, 300ms, ease.in-out, 2 ciclos + borda vermelha. Foco volta ao box 1. Sem toast para erro de MFA.
```

---

## 3. Regras duras

### 3.1 O que NUNCA animar

1. `width`, `height`, `top`, `left`, `margin`, `padding` — causam layout thrash. Usar `transform`/`opacity` apenas. (Exceção única: sidebar collapse usa `width` com 240ms? NÃO — usa `x` + clip, ou troca instant.)
2. Cores de texto em loop, gradientes animados, blur animado (blurs são caros; backdrop-blur aparece/desaparece por opacidade).
3. Números de saldo com count-up decorativo — saldo atualiza instant (dinheiro não "anima"; parece cassino).
4. Tabela inteira re-animando a cada poll — só a célula alterada pisca bg 100ms (flash verde/vermelho sutil, 1x).
5. Spring/bounce em modal, dropdown, página, toast. Bounce = proibido no terminal inteiro.
6. Stagger em listas >20 itens (só os 8 primeiros animam, resto aparece instant) e nunca em polling/live-update.
7. Ícones girando (exceto spinner de loading e refresh em fetching). Seta de collapse = rotate 180° em 160ms, ok.
8. Nada acima de 400ms. Nada infinite além de spinner/shimmer/progress.

### 3.2 `prefers-reduced-motion` — o que vira instant

```tsx
// hooks/use-motion.ts
import { useReducedMotion } from "framer-motion";
export const useSafeTransition = (t: Transition) =>
  useReducedMotion() ? { duration: 0 } : t;
```

| Comportamento | Com reduced-motion |
|---|---|
| Modal/drawer/dropdown/toast/página | `duration: 0` — aparece instant, sem fade/slide |
| Toggle knob, whileTap | Sem spring — estado troca instant |
| Skeleton shimmer, spinner | Shimmer OFF (skeleton estático); spinner vira texto "Carregando…" |
| Shake de erro, stagger, hover lift, QR pop | Todos OFF — borda vermelha instant comunica o erro |
| Toast auto-dismiss progress | Sem barra animada; toast fica até dispensar |

Implementação global: envolver app em `<MotionConfig reducedMotion="user">` — framer-motion zera transform/layout automaticamente.

### 3.3 Layout animations — só onde

`layout` / `layoutId` permitidos em EXATAMENTE 2 lugares: **underline de tab ativa** (`layoutId="tab-underline"`, spring 500/35) e **sidebar item ativo** (pill de fundo, mesma config). Em todo o resto (`layout={false}` explícito em toasts, listas, cards) — layout animation em lista viva = jank + bug com reduced-motion.

### 3.4 Foco visível em movimento

1. Foco NUNCA anima junto com entrada: modal abre (240ms) → DEPOIS o foco move (focus após `onAnimationComplete`, não durante).
2. Ring de foco: aparece instant 100ms (`outline 2px`), nunca faz fade-in lento — usuário de teclado não espera.
3. `:focus-visible` apenas (mouse não mostra ring). Ring = `2px solid accent` + `offset 2px`, contraste ≥3:1.
4. Durante transição de página, foco vai ao `h1` (tabIndex -1) após animação; skip-link "Pular para conteúdo" sempre presente.
5. Shake de erro move o foco junto (para o campo), não só o visual.

---

## 4. Variantes reutilizáveis (copiar para `lib/motion.ts`)

```tsx
import { type Variants } from "framer-motion";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;

export const DUR = { instant: 0.1, fast: 0.16, medium: 0.24, slow: 0.36 } as const;

/** Default: modal, card, popover — scale + fade + rise */
export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 16 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: DUR.medium, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.18, ease: EASE_IN } },
};

/** Drawer lateral / bottom-sheet mobile */
export const slideOver: Variants = {
  hidden: { opacity: 0, x: 320 },
  show: { opacity: 1, x: 0, transition: { duration: DUR.medium, ease: EASE_OUT } },
  exit: { opacity: 0, x: 320, transition: { duration: 0.18, ease: EASE_IN } },
};

/** Dropdown, tooltip, toast entrada, QR (QR usa popIn abaixo) */
export const fadeShift: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.fast, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, transition: { duration: 0.12, ease: EASE_IN } },
};

/** QR, avatar preview, badge novo */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: DUR.fast, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.12, ease: EASE_IN } },
};

/** Backdrop de modal/drawer */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

/** Página (template.tsx) */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.medium, ease: EASE_IN_OUT } },
};

/** Lista: stagger só nos 8 primeiros, resto instant */
export const staggerList: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.fast, ease: EASE_OUT } },
};

/** Erro (MFA, form): shake 4px, 2 ciclos */
export const shake = {
  animate: { x: [0, -4, 4, -4, 0], transition: { duration: 0.3, ease: EASE_IN_OUT } },
};
```

```tsx
// Uso canônico de lista:
// <m.ul variants={staggerList} initial="hidden" animate="show">
//   {items.slice(0, 8).map(i => <m.li key={i.id} variants={staggerItem} />)}
//   {items.slice(8).map(i => <li key={i.id} />)}  {/* resto instant, sem variante */}
// </m.ul>
```

> Setup obrigatório: `<MotionConfig reducedMotion="user">` no root layout + `LazyMotion features={domAnimation}`. `m.*` em vez de `motion.*`. Exit sempre `ease.in` e 25% mais rápido. Nada de `AnimatePresence mode="wait"` entre rotas.

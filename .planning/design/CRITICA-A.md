# CRÍTICA A — Engenharia · Design System Aurum Bit Admin

> Papel: CRÍTICO A (engenheiro). Método: li os 8 docs + confrontei entre si + com a realidade do repo
> (`apps/admin`: Next 14.2.5, `tailwindcss@3.4.19` + PostCSS + autoprefixer **instalados mas NÃO ligados**,
> `framer-motion@^14.1.0` + `lucide-react@^1.55.0` instalados, CSS legado em `app/globals.css` sem nenhuma
> diretiva Tailwind, `tailwind.config.js` stub com só `colors.ink`, `layout.tsx` sem ThemeScript/MotionConfig,
> `components/ui/` com só `skeleton.tsx` + `table.tsx`, sem `clsx`/`tailwind-merge`/`radix`/eslint-plugin).
> Sem elogios vazios. Cito `doc:seção` em tudo.

---

## 1. Contradições entre docs (load-bearing primeiro)

### C1. Blur de modal: QUATRO valores em QUATRO docs — DERRUBA qualquer síntese direta
| Doc | Valor travado |
|---|---|
| `01:§4` E3 | modal `surface-2` + `blur(30px) saturate(1.5)` + scrim `rgba(0,0,0,.45)/.30` |
| `03:§3.1` L3 | overlay `rgb(0 0 0/.40)` + `blur(4px)` no overlay; superfície `blur(var(--glass-blur-3))` = **24px** |
| `04:§1.5` `blur.modal` | backdrop **blur 8px**, fade 160ms |
| `06:§3` | dialog **OPACO** (`--bg-soft`, sem blur, "blur simultâneo estoura o orçamento"), backdrop `rgba(0,0,0,.6)` sem blur |

Agravantes:
- `03:§3.1` define escala `--glass-blur-1/2/3 = 8/16/24px`, enquanto `01:§4` usa `20/24/30px`. Duas escalas de blur "travadas".
- `03:§4` regra 10 **proíbe `backdrop-blur > 24px`** — o que torna o `blur(30px)` de `01:§4` ilegal pelo próprio sistema.
- `01:§4` manda `saturate(1.4/1.5/1.6)` por nível; `03:§3.1` usa `--glass-sat: saturate(180%)` único. Dois regimes de saturação.
- `06:§3` permite `inset 0 1px 0 rgba(255,255,255,.08)` specular no dialog — ok — mas proíbe `backdrop-filter`, enquanto `05:§3.2` manda Command-K em **E3 com `blur(30px)`**. O Command-K é modal ou não é? Pelas duas regras, ele é simultaneamente obrigatório-blur e proibido-blur.
- **Ajuste obrigatório A1:** travar UMA regra: dialog/modal **opaco** (`surface-solid`, sem `backdrop-filter`, backdrop scrim `rgba(0,0,0,.6)` + fade de opacidade 160ms — i.e. vence `06:§3` + `04:§1.5` no que diz respeito a "não animar blur"), Command-K segue a mesma regra (opaco, `md`, sem footer — vence `06:§2.4`, derrota `05:§3.2` no blur). Reescrever `01:§4` E3 (blur 30→0), `03:§3.1` L3 (24→0) e `05:§3.2` (material E3→opaco). Blur fica restrito a **chrome (sidebar/topbar) + card glass E1** — e card glass só sobre fundo não-textual.

### C2. z-index: `05:§3.3` vs `06:§2.4+§3+§5` divergem em drawer e colidem em janela
- `05:§3.3` trava `--z-scrim:45, --z-drawer:46, --z-modal:50, --z-toast:60, --z-tooltip:70`.
- `06:§2.4` usa `.menu z-30` (deveria ser 40 pelo token), `06:§3` `.dialog-overlay z-50` (ok), mas `06:§2.4` drawer usa `.drawer-overlay z-40 + .drawer z-41` — **44/45/46? não: 40/41 vs 45/46. Contradição direta.**
- `06:§5` janela Rastro `.window z-45` **colide** com `--z-scrim:45` de `05:§3.3` (janela não-modal sentada exatamente no layer do scrim).
- `06:§5` é P2 especulativo (nada existe hoje) introduzindo layer novo sem atualizar a tabela de `05`.
- **Ajuste obrigatório A2:** tabela única (vence `05:§3.3`, corrigida): content 0 / sidebar-topbar 30 / dropdown-popover-menu 40 / janela-não-modal 44 (**novo, abaixo do scrim**) / scrim 45 / drawer 46 / modal-Command-K 50 / dropdown-interno-de-modal 51 / toast 60 / tooltip 70 / skip-link 100. Proibir `z-40/z-41` do `06` e `z-45` da janela. `06:§5` sai da síntese v1 (ver V6).

### C3. Tokens de cor: `01` canônico vs `06` legado vs `07` com TODOs — três fontes de verdade
- `01:header` diz "Stack: Next.js 14, **CSS próprio, sem Tailwind**". `05:header`, `06:header`, `07` assumem Tailwind. O doc-mãe de cor nega o stack dos docs-filhos.
- `06` inteiro (e `06:§6` regra de fechamento!) usa nomes legados `--bg/--bg-soft/--bg-softer/--border/--text/--text-dim/--accent-ink/--danger/--ok/--warn/--radius`, enquanto `01:§3` canônico trava `--bg-0/1/2, --surface-1/2/3/solid, --border-subtle/medium/strong, --text-1/2/3, --on-accent, --success/warning/info`. `06:§6` manda fechar com os tokens legados — **a regra de fechamento do doc de componentes contradiz o bloco canônico do doc de cores.**
- `02:§3.4` cita `--text/--bg/--text-dim/--bg-softer/--danger` (legado) — stale vs `01`.
- `03:§1.2/§3.2` referencia `var(--surface)`, `var(--border)`, `var(--fg-muted)` — **nenhuma existe** em `01:§3`. CSS que não compila semanticamente.
- `01:§3` bloco canônico **omite** `--specular`, `--shadow-card`, `--shadow-modal`, `--scrim`, `--danger-text` — mas `01:§4` usa `--specular`, `07:§1.4` referencia `var(--shadow-card)/var(--shadow-modal)`, `07:§1.1` referencia `var(--danger-text, #ff9a9e)` com fallback. Tokens usados e nunca definidos.
- Badge: `06:§2.1` trava hex soltos (`#8ec5ff/#d3a0fa/#7dd68f/#ff9a9e`) como mapa de cor, enquanto `07:§2.3` manda esses mesmos hex **morrerem** (virarem `info/success/danger-text`). Um doc trava o que o outro manda deletar.
- Sombra dourada: `03:§3.1` manda migrar para fora a sombra `rgba(232,179,75,.35)` de `globals.css:613,627,673` e `03:§4` regra 1 proíbe sombra colorida; `07:§1.4` **reintroduz** `"auth-logo": "0 4px 18px rgba(232,179,75,0.35)"` como token oficial.
- **Ajuste obrigatório A3:** (a) reescrever `01:header` (stack = Next 14 + Tailwind v3 + CSS vars como fonte de verdade); (b) publicar no bloco canônico de `01:§3` os faltantes: `--specular` (dark/light), `--shadow-card`, `--shadow-modal`, `--scrim`, `--danger-text: #ff9a9e` (ambos os modos; em light aceitar AA só p/ texto ≥15px sobre bg-1 — validar); (c) reescrever `06` trocando todo legado por canônico (lista fechada em `07:§2.1`, sem exceção); (d) `02:§3.4` e `03:§1.2/§3.2` atualizados para nomes canônicos; (e) decidir sombra dourada: **manter UMA exceção documentada** (`auth-logo` + anel de foco — acessibilidade/marca) e `03:§4` regra 1 ganha a redação "exceções taxativas: anel de foco + logo auth; resto vetado". Sem isso, lint (§3.3 do 07) é inexequível.

### C4. Motion `04:§3.1` vs sidebar `05:§1.1`: a "única exceção" que o outro doc veta nominalmente
- `05:§1.1`: "Colapso anima `width 288→64` em `360ms ease.out` (`motion.slow` — **única exceção que anima `width`**...)".
- `04:§3.1` regra 1: "`width`... causam layout thrash... **(Exceção única: sidebar collapse usa `width` com 240ms? NÃO — usa `x` + clip, ou troca instant.)**" — o doc 04 cita e veta nominalmente a exceção que o 05 reivindica, com duração diferente (240 vs 360ms).
- `07:§2.3` item 3 fica do lado do 04 (manda deletar `transition: width .15s`).
- Placar: 2 docs × 1. **Vence o 04.**
- **Ajuste obrigatório A4:** `05:§1.1` reescrito: colapso = troca **instant** de width (classe) + crossfade `opacity` 160ms do conteúdo interno + `MotionConfig reducedMotion` já cobre o resto; proibir `transition: width`. Manter anti-flash (`data-sidebar` + cookie) que é a parte boa do `05:§4.1`.

### C5. Ícones/rotas `03:§2` vs `05:§5`: mesmos slots, nomes diferentes; 8 vs 10 rotas
- Clientes: `UsersRound` (03) vs `Users` (05). Financeiro: `Wallet` (03) vs `Landmark` (05). Filas: `Inbox` (03) vs `ListOrdered` (05).
- `03:§2.1` lista 10 rotas (inclui **Usuários** e **Assinaturas**); `05:§5` trava **8 rotas, 3 grupos**, sem Usuários nem Assinaturas — mas `06:§0/§1.4/§4` e `08` assumem Assinaturas viva (paginação, `CancelSubscriptionDialog`, fatia 4 B4/B5). `05` deleta rota que o resto do sistema usa.
- Stroke: `03:§1.2` default **1.75** (16px→1.5, 24px→2); `05:§2` usa `strokeWidth={2}` default e `2.25` ativo; `07:§4.2/4.3` usa `h-4 w-4` (16px) com stroke default 2 — viola a regra 16px→1.5 do 03.
- **Ajuste obrigatório A5:** inventário único (vence `03`, autoridade em ícone): `LayoutDashboard, UsersRound, ReceiptText, Landmark, ListOrdered, Package, ScrollText, KeyRound` + `Usuários` e `Assinaturas` reintegrados a `05:§5` (5 grupos ou 4 — reordenar, não amputar). Stroke: wrapper `Icon` de `03:§1.2` é obrigatório e `05:§2`/`07:§4` passam a usá-lo (regra 16→1.5, 20→1.75, 24→2; ativo aumenta **fundo/peso**, não stroke — `2.25` morre). Auditar nomes contra `lucide-react@^1.55.0` instalada (ver I5).

### C6. Tooltip: Radix (05) vs `title`-only (06) — dependência nova decidida em sentidos opostos
- `05:§2.3`: "TRAVADO: **Radix, não `title`**".
- `06:§2.4`: "**Não criar lib de tooltip** (P2 no máximo)", `title=` + `aria-label` bastam.
- Radix não instalado. `05` também usa `title` nativo proibido em `05:§5` regra 2 e `06:§1.3` usa `title=` em célula Máquinas. Os docs proíbem `title` e usam `title`.
- **Ajuste obrigatório A6:** v1 = **sem Radix**. Tooltip do colapsado = CSS-only (`group-hover` + `role="tooltip"`, delay 400ms via `transition-delay`, `fadeShift` 160ms) + foco visível; `title=` permitido **só** como espelho de texto truncado (células/IDs), nunca como único rótulo de ação (ação = `aria-label` no botão). Radix (ou headless próprio) vira P2 pós-v1. Reescrever `05:§2.3`.

### C7. Toast: existe (03/04/05) vs não-existe (06) — decisão de produto mascarada de detalhe
- `03:§3.1` L4 (toast E4 + 4–6s), `04:§2.4` (padrão toast completo), `05:§3.3` (`--z-toast:60`, "acima de modal") assumem toast flutuante.
- `06:§2.2` trava "**sem toast flutuante** como decisão" — sucesso = `.card[role=status]` inline; `06:§2.3` "❌ toast flutuante p/ erro crítico".
- Ambos os lados estão "travados". Não é detalhe: muda z-index, motion, a11y (live regions) e todas as mutações de `08` (que precisam de feedback de sucesso com `auditId`).
- **Ajuste obrigatório A7:** travar: **erros/sucesso de mutação = inline ancorado** (vence `06`: `role=status/alert` + retry + `auditId` clicável); toast **permitido só** p/ confirmações não-críticas reversíveis (copiado, tema trocado, sidebar) com `role=status`, max 3, 5s, sem ação obrigatória. `04:§2.4` mantido só p/ esse escopo; `05:§3.3` mantém `z-toast` (uso restrito). `08` fatias passam a citar "sucesso inline + `auditId`" em L2/L3/B3/B5/F5/F6/Q2 em vez de toast genérico.

### C8. Tipografia `02` vs `05:§1.1`/`06:§1.3`: piso e `td` divergentes
- `02:§2` `micro` = **12.5px/0.78rem/600, piso absoluto**; `02:§3.3` "nada abaixo de `micro`".
- `05:§1.1` rótulo de grupo = "`micro` **11px**/600 uppercase +0.08em". 11px ≠ 12.5px e está abaixo do piso. `05` redefiniu o token.
- `06:§1.3` CSS trava `table.data { font-size: 0.92rem }` enquanto `02:§4` manda `td → body 15px` ("0.92 era resquício") e `07:§2.3` manda o `0.92` morrer.
- Mono KPI: `02:§2` `kpi-currency` = mono+tnum; `06:§2.2` `.kpi-value` sem `font-family` (sans implícito) — o CSS canônico do 06 desfaz o token do 02.
- **Ajuste obrigatório A8:** rótulo de grupo = 12.5px (`text-micro`) ou, se 11px for inegociável p/ densidade, `02:§3.3` ganha exceção documentada "rótulo de grupo decorativo `aria-hidden` pode usar 11px" — sem redefinição silenciosa. `06:§1.3` `td` → `text-body`; `.kpi-value[data-kind=currency]` → mono+tnum.

### C9. Breakpoint do drawer: 900 (legado) vs 901 (07) vs 1024 (05) — e `07` redefine `lg`
- Legado `globals.css` (citado em `02:header` e `07:§1`): sidebar some em `max-width:900px`.
- `07:§1` propõe `md: 901px` (com `TODO consenso`) e `lg: 1200px`.
- `05:§1.1/§4.2` trava drawer em **`1024px** (`lg`)`, "sem modo intermediário".
- `07` redefinir `lg=1200px` quebra o sentido de `lg` em `05` e em qualquer `lg:` default do Tailwind (1024). Três breakpoints, dois deles com o mesmo nome e valores diferentes.
- **Ajuste obrigatório A9:** travar **`1024px` para drawer** (vence `05`; alinha com Tailwind default `lg`), `md` permanece **768px default** (derruba o `901px`), `lg` permanece **1024px default** (derruba `1200px`). `max-w-content 75rem` continua como token de conteúdo, não breakpoint. Migrar a media query legada `900px→1024px` na Fase 3 do `07:§2.4`.

### C10. Botão: dois sistemas de motion + `icon` 36px vs HIG 44px
- `06:§1.1`: `:active translateY(1px)`, sem framer; admite `.btn-icon` hoje ~36px, "elevar p/ 44px".
- `07:§4.2`: `m.button whileTap scale .97 whileHover y -1` (sistema `04:§2.7`).
- `07:§4.2` `sizes.icon = h-9 w-9` = **36px** — viola `03:§1.3` (44px) e o próprio `06:§1.1` ("elevar p/ 44px").
- `03:§1.3` foco = `outline 2px accent`; `01:§2` regra 4 foco = `box-shadow 0 0 0 2px bg + 0 0 0 4px focus`; `07:§4.2` usa o box-shadow. Três redações de foco (duas compatíveis, uma divergente).
- **Ajuste obrigatório A10:** motion de botão = `04:§2.7` (vence; `06:§1.1` `translateY` morre). `icon` = `h-11 w-11` (44px) com glyph 16/20px centralizado; em tabela densa, 44px via padding da célula (`03:§1.3` já prevê). Foco = box-shadow duplo de `01:§2` regra 4 em tudo; `03:§1.3` atualizado.

---

## 2. Regras inexequíveis no stack (Tailwind v3 + Next 14 + CSS legado)

### I1. Tailwind instalado mas morto — `07` subestima a Fase 0
`globals.css` não tem `@tailwind base/components/utilities`; `tailwind.config.js` é stub (`colors.ink` placeholder que `07:§1` manda matar). Nada no repo usa Tailwind hoje. A Fase 0 de `07:§2.4` ("nenhum JSX muda, screenshot idêntico") exige: adicionar diretivas + bloco canônico + aliases + `@layer base` + ThemeScript + `lib/cn.ts` — tudo no mesmo PR, com `next build` verde. É factível, mas **não é "1 PR sem risco"**: `@tailwind base` injeta preflight que reseta `h1/th/button` do legado (o `h1` sem margem de `02:§4` e o `th` 600 dependem do estilo atual). **Correção mínima:** Fase 0 dividida em 0a (diretivas + `preflight: false`? não — melhor: manter preflight e fixar os 3 resets que quebram: `h1 margin:0`, `button background:transparent`, `th font-weight`) + 0b (tokens + aliases). Ou desabilitar preflight explicitamente no config (`corePlugins: { preflight: false }`) e documentar — decisão a travar na síntese, não deixar implícita.

### I2. `darkMode: 'class'` + `[data-theme]` dual — regra correta, peça faltando
`07:§3.1` + `05:§4.1` exigem sincronia `.dark`/`data-theme` + ThemeScript inline + `suppressHydrationWarning`, mas o repo tem `layout.tsx` nu (sem script, sem classe, sem `MotionConfig`). Nenhum doc entrega o **código final** do ThemeScript (só esqueleto comentado). **Correção mínima:** síntese publica o script inline final (~10 linhas, `try/catch`, default `dark`, seta `dataset.theme` + `classList`) + `cookies` `aurum-theme`/`ab_sidebar` lidos no Server Component (hoje nada é lido no servidor — `05:§4.1` promete SSR sem flash mas o repo não tem o Layout que faz isso).

### I3. `var()` + modificador de opacidade não funciona — `07` acerta o diagnóstico, mas o repo inteiro viola
`bg-accent/50` com `var(--accent)` hex não compila sentido no Tailwind v3 (07:§1 avisa). Mas o legado usa `rgba()` livre e `06` usa `borderColor: var(--ok)` inline. **Correção mínima:** manter a proibição (`07:§3.3` CI grep) + publicar os `*-soft` como única opacidade permitida (já existem) + trocar o grep proposto (que usa `/(50|75)\b` e dá falso-positivo em `w-1/2`? não — `/(50|75)` pega `/50` em qualquer classe; ok, mas ancorar em `bg-|text-|border-` p/ não pegar `max-w-/...`: na prática `/(50|75)\b` após `-` já é suficiente; manter + testar no CI antes de virar erro bloqueante — começar como `warn`).

### I4. `backdrop-blur-*` custom + `saturate` obrigatório — config `07:§1.5` ok, uso nos exemplos incompleto
`backdrop-blur-card/chrome/modal` + `backdrop-saturate-140/150/160` existem no config proposto. Mas após A1 (modal opaco), `backdrop-blur-modal`/`scrim` morrem — remover do config p/ não virar armadilha. E todo `.glass` precisa do fallback `@supports not` + `prefers-reduced-transparency` (07:§2.2 tem; 01:§4 tem; 03 omite no exemplo §3.2 — o exemplo canônico `.glass-card/.glass-pop` não inclui fallback nem `-webkit-` no segundo bloco). **Correção mínima:** exemplo canônico único na síntese (com `-webkit-`, fallback, saturate), demais docs referenciam em vez de duplicar.

### I5. `lucide-react@^1.55.0` instalada vs `03:§1.1` "travar `^0.4xx`" — pin impossível + nomes por auditar
O repo já está em `^1.55.0` (major à frente do pin do doc). "Fixar minor em 0.4xx" significaria **downgrade**. E nomes como `UsersRound/UserRound/KeyRound/ReceiptText/Repeat2/ScrollText/Landmark/ListOrdered/SunMoon/CircleUserRound/TriangleAlert/CircleCheck` precisam de `tsc` contra a versão instalada (renames acontecem entre majors: `AlertTriangle→TriangleAlert`, `CheckCircle2→CircleCheck` o próprio 03 admite). **Correção mínima:** derrubar o pin `^0.4xx`; travar `lucide-react@^1.55.0` (a instalada); rodar `tsc --noEmit` + grep de import após A5 e corrigir nomes que não existirem. `Icon` wrapper (03:§1.2) vira lei — nenhum import direto de ícone em página.

### I6. `framer-motion@^14.1.0` vs docs em `v11` — provavelmente ok, verificar 3 APIs
Docs usam `m + LazyMotion(domAnimation) + MotionConfig reducedMotion="user" + layoutId + drag`. Major 11→14 pode ter removido/renomeado (`motion` package, `LazyMotion` features). **Correção mínima:** antes da síntese, compilar um smoke (`lib/motion.ts` de `04:§4` + 1 modal + 1 drawer) com `next build`; se `LazyMotion/domAnimation` falhar, cair para `motion.*` direto (bundle maior, sem drama na v1). Não travar `v11` (downgrade sem motivo).

### I7. `tailwind-merge` custom groups (`07:§3.2`) — API incerta na versão a instalar
O próprio doc marca `TODO consenso`. `extendTailwindMerge({ extend: { textStyle: [...] } })` pode não existir na versão instalada (API de custom groups mudou entre v1/v2). **Correção mínima:** instalar `clsx + tailwind-merge` (sem eles `cn()` é bug — diagnóstico do 07 está certo), mas na síntese adotar a **alternativa já admitida**: convenção "nunca dois `text-*` de token no mesmo `cn()`" + lint humano, e só registrar custom group se a versão instalada suportar (testar em 5 min com `node -e`). Não bloquear a fundação nisso.

### I8. `eslint-plugin-tailwindcss no-arbitrary-value` (`07:§3.3`) — plugin pode não ter essa regra
`07` prescreve regra `no-arbitrary-value: error` + allowlist. Se o plugin instalado não expuser essa regra exata, a Fase 4 "liga fiscalização como erro" quebra o CI no dia 1. **Correção mínima:** fiscalização primária = **CI grep** (determinístico, sem plugin) desde a Fase 0 como `warn`, promovido a `error` na Fase 4; ESLint plugin vira camada opcional (só se a regra existir na versão instalada — verificar, não presumir).

### I9. `color-mix` (`03:§3.2`) + Safari/antigos — ok moderno, sem fallback no exemplo
`color-mix(in srgb, var(--surface) 72%, transparent)` exige além de var inexistente (C3) um navegador recente. Admin interno: aceitável, mas o exemplo não tem fallback opaco. **Correção mínima:** após A3 (vars canônicos), reescrever exemplo com `background: var(--surface-1)` declarado **antes** da linha `color-mix` (fallback natural em cascata) + manter `@supports` do `01`.

### I10. 44px em tabela densa + `h-9` (36px) padronizado em `07:§4` — HIG vs densidade
`Input h-9`, `Button md h-9`, `icon h-9` = 36px < 44px HIG. Elevar tudo p/ 44px quebra ritmo de tabela/filtro denso; manter 36px viola `03:§1.3`. **Correção mínima:** distinguir **alvo de toque** (área clicável ≥44px via padding/gap — `03:§1.3` já prevê p/ tabela) de **altura visual** (36px ok p/ input/button-md em linha densa). `icon` isolado (fora de tabela) = 44px. `07:§4.2/4.3` corrigidos nessa linha; `03:§1.3` ganha a frase "altura visual 36px admitida em linha densa desde que o pitch/alvo totalize 44px".

---

## 3. Buracos: o que nenhum doc cobre e é necessário para buildar

1. **`lib/cn.ts` + deps**: só `07:§3.2` define; `01–06` usam classes como se `cn` existisse. Falta: `pnpm add clsx tailwind-merge` executado + arquivo criado + import path (`@/lib/cn` exige `paths` no `tsconfig` — verificar; repo usa `@/` nos exemplos mas `tsconfig.json` não foi auditado por nenhum doc).
2. **ThemeScript final**: `07:§3.1` dá esqueleto com comentário, não código colável. Falta o script inline exato + onde lê cookie no servidor + `suppressHydrationWarning` + `color-scheme`.
3. **Estrutura de pastas dos componentes**: `06:§6` lista P0/P1 (`Button/Dialog/DestructiveForm/Field/Table/Pager/...`) mas não diz onde moram (`components/ui/` vs domínios), nem barrel (`components/ui/index.ts`?), nem convenção de props (variantes via `cva`? não — docs vetam dep nova implicitamente; então variantes = objetos literais como em `07:§4.2` — travar isso), nem quais são Client Components.
4. **Regra RSC vs Client**: `framer-motion`, Radix (se voltar), `useState` (PasswordInput), roving tabindex, Command-K, toggle tema — tudo `"use client"`. Nenhum doc marca a fronteira. Falta: regra "todo componente com motion/estado/listener = `"use client"`; resto Server" + `template.tsx` da transição de página (`04:§2.5` cita `app/template.tsx` mas o arquivo não existe no repo).
5. **Dialog funcional**: `06:§3` dá CSS + anatomia JSX, mas sem implementação (focus trap, `initialFocus`, trava de `pending`, `Escape`, overlay `onMouseDown`, `aria-labelledby`). É P0 — sem esse código não há build.
6. **Decisão toast final**: ver C7/A7 — nenhum doc consolida; a síntese precisa publicar a regra + (se toast restrito existir) o componente mínimo + live region.
7. **Átomos restantes sem classes**: `Field/select/textarea/checkbox/Search/Date`, `Table/Pager/FilterBar`, `Tabs/Segmented/Menu`, `Empty/Error/Stale/Forbidden/Skeleton`, `Badge/Dot/TimezoneBadge`, `MaskedJson/LicenseKeyMasked`, `KpiCard` — `07:§4` só exemplifica 3 (GlassCard/Button/Input). Todo o resto do P0/P1 não tem className canônico.
8. **Persistência tema + sidebar unificada**: `05:§4.1` (cookie `ab_sidebar` + localStorage espelho + `data-sidebar` anti-flash) vs `07:§3.1` (só localStorage `aurum-theme`, cookie "opcional fase 3"). Duas estratégias p/ duas prefs irmãs. Falta: mesma estratégia p/ ambas (cookie + localStorage + atributo no `<html>` + leitura SSR).
9. **Contraste light pendente de validação**: `01` afirma ratios (5.9:1, 6.2:1...) sem ferramenta/método; `--danger-text #ff9a9e` sobre light não foi calculado (é claro sobre branco — provavelmente **reprova**; em light o texto de erro deveria ser `--danger #C92A30`, reservando `#ff9a9e` só p/ dark). Nenhum doc separa `danger-text` por modo. Falta: tabela `danger-text` dark `#ff9a9e` / light `var(--danger)` + teste (ex.: `axe` ou cálculo documentado).
10. **Scroller/scrollbar, `100dvh`, `overscroll`, impressão**: `05` usa `100dvh` (correto) mas o legado usa `100vh` (`globals.css` `.sidebar/.shell`); nenhum doc manda a troca global. Scrollbar fina (`05:§1.1` só na nav), `overscroll-behavior`, `@media print` (admin financeiro imprime fatura — zero cobertura).
11. **Testes/lint de design**: UATs por doc existem (`05:checklist`, `07:apêndice`), mas falta o plano global: `tsc --noEmit` + `next build` + CI grep (I8) + `stylelint` ou não + teste em escala de cinza (daltônico) + zoom 200% (`02:§3.3`) + reduced-motion/transparency. Nenhum doc diz quem roda o quê e quando.
12. **`08` → UI copy faltante**: códigos novos `UPSTREAM_UNAVAILABLE` (502), `ACCOUNT_REQUIRED` (422), `REUSE_DETECTED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_LOCKED` + `mode:'logical'` DLQ + polling MISS de projeção — nenhum tem copy pt-BR travada nem componente dono (qual `ErrorState`? qual modal ganha seletor de conta em F5/F6?). `08` é o doc mais sólido, mas termina na borda do BFF sem atravessar para a tela.
13. **Migração de rotas `(app)` vs `(auth)`**: `07:§2.4` Fase 1/3 cita `AuthLayout`/shell mas o repo tem `app/(app)` + `app/(auth)` (ver `ls`: `(app)` e `(auth)` existem) — nenhum doc mapeia grupo→layout→chrome (onde vivem Sidebar/Topbar/template). Falta o mapa layout (root → auth/app → páginas).
14. **Chart/recharts**: `06:§2.4` trava cores do gráfico (`#46a758/#e5484d`, grid `#2a2f3a`, tick `#a7adbb`) em hex solto — fora de token, sem dark/light, sem `*-soft`. Ou entra no sistema (tokens `chart-*`) ou fica isolado documentado como exceção.

---

## 4. Veredito por doc + AJUSTES OBRIGATÓRIOS (lista fechada)

| Doc | Veredito | O que fazer antes da síntese |
|---|---|---|
| `01-cores` | **AJUSTAR** (manter 90%) | A1 (E3 opaco), A3 (header stack + bloco canônico completo: `--specular/--shadow-card/--shadow-modal/--scrim/--danger-text` por modo), separar `danger-text` dark/light (buraco 9) |
| `02-tipografia` | **MANTER** (ajuste pontual) | A8 (td/mono + micro vs 11px), trocar nomes legados em `§3.4` por canônicos |
| `03-icones-sombras` | **AJUSTAR** | A1 (blur 24→opaco modal; escala única 20/24 p/ chrome+card), A3 (vars inexistentes + sombra dourada→exceção taxativa), A5/A10 (stroke via wrapper, foco box-shadow), exemplo `§3.2` com fallback `-webkit-` |
| `04-motion` | **MANTER** (doc mais sólido; vence C4) | Nada estrutural; só registrar escopo do toast (A7) + que sidebar cede no width |
| `05-sidebar` | **AJUSTAR** | A2 (z), A4 (width→instant), A5 (ícones+rotas reintegradas), A6 (sem Radix v1), A9 (1024px), A1 (Command-K opaco), `strokeWidth 2.25` morre |
| `06-componentes` | **AJUSTAR FORTE** (núcleo P0 válido, invólucro com legado) | A2/A3/A7/A8/A10 (tokens canônicos em todo o doc; `td` 0.92 morre; toast inline+restrito; z corrigido); **`§5 (carrossel + janela) DERRUBADO da síntese v1`** — volta como proposta pós-v1 quando houver roadmap; `TraceabilityDrawer→Dialog` rename mantido |
| `07-tailwind` | **AJUSTAR** (arquitetura certa, TODOs abertos) | Resolver TODOs: `md/lg` (A9), `--danger-text/--shadow-*` (A3), `tailwind-merge` groups (I7), ESLint rule (I8); `icon h-9→h-11` (A10); remover `backdrop-blur-modal/scrim` pós-A1; documentar preflight (I1); `text-indent` arbitrário do CodeInput vira classe CSS (exceção a menos) |
| `08-dados-reais` | **MANTER** (fora do DS visual; melhor doc de execução) | Buraco 12: adicionar apêndice de copy pt-BR + componente dono por código novo; referenciar A7 (feedback inline) nas 6 fatias |

### AJUSTES OBRIGATÓRIOS (fechado — nada sintetiza sem estes)
1. **A1 — modal/dialog/Command-K opacos** (reescrever `01:§4` E3, `03:§3.1` L3, `05:§3.2`; remover `backdrop-blur-modal/scrim` do config).
2. **A2 — z-index único** (content 0 / chrome 30 / menu 40 / janela 44 / scrim 45 / drawer 46 / modal 50 / dropdown-in-modal 51 / toast 60 / tooltip 70 / skip 100).
3. **A3 — tokens únicos** (bloco canônico completo + `06`/`02:§3.4`/`03` migrados p/ nomes canônicos; sombra dourada = exceção taxativa documentada).
4. **A4 — colapso instant** (derruba `width 360ms` do `05:§1.1`; vence `04:§3.1`).
5. **A5 — ícones/rotas únicos** (autoridade `03`; reintegra Usuários+Assinaturas; wrapper `Icon` obrigatório; auditar nomes contra instalada).
6. **A6 — sem Radix v1** (tooltip colapsado CSS-only; `title` só espelha truncado).
7. **A7 — feedback: inline por padrão, toast só confirmação não-crítica** (reescreve `04:§2.4` escopo + `06:§2.2` + `08` fatias).
8. **A8 — tipo: `td` body, KPI-mono, grupo 12.5px ou exceção documentada.**
9. **A9 — breakpoints default** (drawer 1024; `md` 768; `lg` 1024; migrar query legada 900→1024).
10. **A10 — botão `04:§2.7`, `icon` 44px, foco box-shadow duplo em tudo.**
11. **A11 — fundação buildável**: `clsx+tailwind-merge` instalados, `lib/cn.ts`, ThemeScript final + prefs unificadas (cookie+localStorage+SSR), regra RSC/Client, `template.tsx`, mapa `(auth)/(app)`, plano de lint/CI (grep primeiro, plugin depois), smoke `next build` de motion v14 + lucide 1.x antes da síntese.

Sem A1–A11 cumpridos, a síntese vira colagem de contradições. Com eles, `04` + `08` sustentam, `01/02/07` fecham, `03/05/06` obedecem.

# 05 — Sidebar / Navegação · Aurum Bit Admin (Liquid Glass + HIG)

> Status: TRAVADO. Valores exatos. Stack: Next.js 14 App Router + framer-motion v11 + lucide-react + Tailwind (mapeado p/ tokens do `01-cores.md` via arbitrary values — nenhum hex solto). Apple HIG: chrome translúcido, conteúdo opaco.
> Herda de `01` (tokens `surface-3`, `specular`, `accent-soft`), `02` (escala `headline`/`micro`/`brand`, pesos 400/600/800) e `04` (`DUR`, `EASE_OUT`, `fadeShift`, `slideOver`, `MotionConfig reducedMotion="user"`).

---

## 1. Anatomia travada

### 1.1 Larguras / alturas / paddings / raios

| Parte | Valor travado | Nota |
|---|---|---|
| Sidebar expandida (desktop `≥1024px`) | `width: 18rem (288px)` fixo | Não é fluido, não é `20%`. Colapso anima `width 288→64` em `360ms ease.out` (`motion.slow` — única exceção que anima `width`, porque é chrome estrutural; conteúdo interno faz `opacity` crossfade, nunca reflow de texto) |
| Sidebar colapsada (desktop) | `width: 4rem (64px)` fixo | Só ícones 20px centralizados. Label some com `opacity 0 + x -4px` em 160ms, não re-empilha |
| Drawer mobile (`<1024px`) | `width: 320px, max-width: 85vw`, `height: 100dvh` | Anima `x: 320→0` (`slideOver`, 240ms `ease.out`) — NUNCA anima `width` aqui. `320px` = `shift.lg` do `04` |
| Altura sidebar | `height: 100dvh`, `position: sticky; top: 0` (desktop) / `fixed` (drawer) | `100dvh`, não `100vh` (barra mobile) |
| Brand header | `height: 64px`, `padding: 0 16px`, borda-bottom `1px var(--border-subtle)` | Logo `A` 32px + `brand` 16.8px/800 + sub 13.1px. Colapsada: só logo 32px centralizado, texto `display:none` (não `opacity:0` — evita leitor de tela duplo) |
| Área de nav (scroll) | `flex:1; overflow-y:auto; padding: 12px 12px 16px` | Scroll fino `::-webkit-scrollbar 6px`, thumb `var(--border-strong)`. Uma seção nunca cola na outra: `gap entre grupos: 20px` |
| Footer usuário | `min-height: 64px`, `padding: 12px`, borda-top `1px var(--border-subtle)` | Avatar 32px + nome `headline` truncado + botão `…` 32px. Colapsado: só avatar |
| Topbar | `height: 56px`, `padding: 0 16px (mobile) / 0 24px (desktop)` | Glass igual sidebar. Contém: hamburger (só `<1024px`), breadcrumb/`title-page`, busca Command-K trigger, toggle tema, avatar |
| Item de nav | `height: 40px`, `padding: 0 12px`, `gap: 12px`, `radius: 10px` | Pitch efetivo 44px (`40px + 4px margin-bottom`) = alvo HIG 44pt. Colapsado: `40×40` centrado, `padding: 0` |
| Rótulo de grupo | `height: 28px`, `padding: 0 12px`, `margin: 20px 0 4px` (primeiro grupo `margin-top: 4px`) | `micro` 11px/600 uppercase `+0.08em` em `var(--text-3)`. Colapsado: vira `divider 1px × 24px` centrado, texto oculto |
| Toggle colapso | botão `32×32`, `radius: 8px`, fixo no canto inferior-direito da sidebar ou no header (escolher: **header, ao lado do logo**) | Ícone `ChevronsLeft`/`ChevronsRight` 16px, rotate 180° em 160ms |

### 1.2 Material glass por modo

Sidebar + topbar = **E4 chrome** (`01 §4`): `background: var(--surface-3)` + `backdrop-filter: blur(24px) saturate(1.6)` (+ prefixo `-webkit-`).

| Modo | Fundo | Filtro | Borda + luz |
|---|---|---|---|
| Dark | `rgba(21,24,30,0.50)` | `blur(24px) saturate(1.6)` | `border-right: 1px solid var(--border-subtle)` + `box-shadow: inset 0 1px 0 rgba(255,255,255,0.10)` (specular só no topo, sem sombra externa — chrome não flutua) |
| Light | `rgba(244,245,247,0.55)` | `blur(24px) saturate(1.6)` | `border-right: 1px solid var(--border-subtle)` + `inset 0 1px 0 rgba(255,255,255,0.70)` |

Regras duras:
1. Sidebar/topbar têm `radius: 0`. Glass vai de borda a borda.
2. Fallback: `@supports not (backdrop-filter: blur(1px)) { .sidebar,.topbar { background: var(--surface-solid); } }`. Em `prefers-reduced-transparency: reduce`, força sólido (mesma regra do `01 §5`).
3. NUNCA animar `backdrop-filter`. Colapso anima `width/opacity/transform` apenas.
4. Dropdown/tooltip/menu que abrem SOBRE a sidebar são **opacos** (`var(--surface-solid)`, sem blur) — máximo 3 blurs simultâneos (sidebar + topbar + página). Ver §3.
5. Tailwind: usar arbitrary values colados no token — ex.: `bg-[var(--surface-3)] backdrop-blur-[24px] saturate-[1.6] border-r border-[var(--border-subtle)] w-72 data-[collapsed]:w-16`. Nenhum `bg-white/60` ou `bg-zinc-900` direto.

---

## 2. Item de navegação

Estrutura canônica (Next `Link` + framer-motion só na pill):

```tsx
<Link href="/clientes" aria-current={active ? "page" : undefined}
  className="navitem" data-active={active} data-disabled={false}>
  {active && <m.span layoutId="sidebar-active-pill" className="navitem-pill"
    transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
  <Icon size={20} strokeWidth={2} aria-hidden />
  <span className="navitem-label truncate">Clientes</span>
  {count != null && <span className="badge">{count}</span>}
</Link>
```

```css
.navitem { position: relative; display: flex; align-items: center; gap: 12px;
  height: 40px; padding: 0 12px; border-radius: 10px; margin-bottom: 4px;
  font-size: 0.9375rem; line-height: 1.45; color: var(--text-2); font-weight: 400; }
.navitem svg { width: 20px; height: 20px; flex: none; }
.navitem-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.navitem-pill { position: absolute; inset: 0; border-radius: 10px;
  background: var(--accent-soft); border: 1px solid transparent; }
.navitem[data-active="true"] { color: var(--text-1); font-weight: 600; }
.navitem[data-active="true"]::before { content: ""; position: absolute; left: -12px; top: 8px; bottom: 8px;
  width: 3px; border-radius: 999px; background: var(--accent-strong); } /* dark: --accent */
```

### 2.1 Estados (todos distinguem por peso/forma, nunca só cor)

| Estado | Visual travado |
|---|---|
| Default | `400` em `var(--text-2)`, ícone `strokeWidth 2`, sem fundo |
| Hover | `background: var(--border-subtle)` (troca instant 100ms), texto → `var(--text-1)`. Sem deslocamento, sem scale |
| Active | Fundo `var(--accent-soft)` (pill com `layoutId`, spring 500/35 — um dos 2 únicos `layoutId` permitidos no app, cf. `04 §3.3`) + texto `600` em `var(--text-1)` + **indicador 3px** `var(--accent)` (dark) / `var(--accent-strong)` (light) na borda esquerda + ícone `strokeWidth 2.25`. `aria-current="page"`. Contraste duplo (fundo + barra) = legível p/ daltônico |
| Focus-visible | `outline: none; box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 4px var(--focus)` (regra `01 §2`). Aparece instant 100ms. Mouse (`:focus:not(:focus-visible)`) sem ring |
| Disabled | `opacity: 0.4`, `pointer-events: none`, `aria-disabled="true"`. Nunca usar `--text-3` como "disabled legível" — disabled não precisa passar AA, precisa parecer desligado |
| Pressed | `scale: 0.98` (`whileTap`, spring 700/30) — sutil, sem bounce |

### 2.2 Badge de contagem

- Slot à direita do label, `margin-left: auto`. Formato: `h: 20px; min-width: 20px; padding: 0 6px; radius: 999px; font: micro 12.5px/600 (+0.02em) + tabular-nums`.
- Cores: default neutro (`var(--border-medium)` bg? TRAVADO: fundo `var(--accent-soft)`, texto `var(--accent-strong)` light / `var(--accent)` dark). Alerta (filas travadas): fundo `var(--danger-soft)`, texto `var(--danger)`. Nunca texto branco sobre soft.
- Regra de número: `>99` vira `99+`. `0` esconde o badge (não mostra "0"). Atualização de count: crossfade 160ms, sem spring, sem `layout`.
- Colapsado: badge vira **dot** `8px` no canto superior-direito do ícone (mesma cor), com `aria-label` preservado no link ("Filas, 5 pendentes").

### 2.3 Tooltip no modo colapsado (e SÓ nele)

- Expandida: sem tooltip (label visível — tooltip duplo é ruído).
- Colapsada: cada item ganha tooltip à direita: `surface-solid` opaco, `radius: 10px`, `padding: 6px 10px`, `headline` 15px/400, `max-width: 200px`, sombra E1. Delay `400ms`, animação `fadeShift` 160ms `ease.out`, `transform-origin: left center`. Inclui sufixo de contagem quando houver badge ("Filas — 5 pendentes"). `role="tooltip"`, dispara em hover E focus (teclado precisa).
- Implementação: `Tooltip` próprio (Radix `@radix-ui/react-tooltip` com `delayDuration={400}`) ou `title`? TRAVADO: **Radix, não `title`** (`title` nativo atrasa 2s e não é estilizável nem acessível por teclado).

### 2.4 Área de toque e grupo

- Alvo mínimo: pitch 44px (item 40px + gap 4px). No drawer mobile, item sobe para `44px` de altura (dedo > mouse). Ícone permanece 20px.
- Grupo: `<nav aria-label="Principal"><p class="navgroup-label" aria-hidden>…` + `<ul><li>` por item. Rótulo `11px/600 uppercase +0.08em var(--text-3)` — decorativo por definição (não precisa AA, mas nunca usar como único indicador de seção para leitor de tela: o `aria-label` do `<nav>` carrega o nome).
- Separador entre grupos só via espaçamento (20px), sem linha — linha só acima do footer de usuário.

---

## 3. Elevação de menus e z-index travado

### 3.1 Dropdown da sidebar (submenu / "mais")

- **Decisão: NÃO usar submenu expansível em árvore na v1.** As 8 rotas cabem em 3 grupos planos (§5). Submenu aninhado em sidebar colapsável = armadilha de foco + hover-tunnel. Se um dia precisar: abre como **popover opaco** à direita do item (`surface-solid`, `radius: 10px`, `padding: 6px`, item filho `32px` de altura), animação `fadeShift` 160ms, fecha em 120ms, `Escape` fecha e devolve foco ao trigger. Nunca accordion que empurra layout (viola `04 §3.1`).
- Menu de usuário (footer): popover para cima (`transform-origin: bottom`), mesmo material opaco, itens: `Perfil`, `Trocar tema`, `Sair` (perigo). Largura `240px`, item `36px` com ícone 16px. `Sair` em `var(--danger)` com ícone `LogOut`.

### 3.2 Command-K — SIM, com escopo travado

- **SIM.** Atalho `Cmd/Ctrl+K` global no admin + botão na topbar (`⌘K`, `h: 32px`, `radius: 8px`, borda `var(--border-medium)`, placeholder "Buscar…"). Também `/` foca a busca quando não estiver em input.
- Material: **E3 modal** (`surface-2` + `blur(30px) saturate(1.5)` + scrim `rgba(0,0,0,0.45)` dark), `width: 640px max 92vw`, `radius: 18px`, entrada `fadeScale` 240ms. Input interno **opaco** (`surface-solid`, regra `01 §5`).
- Escopo (nada além disso na v1): ① navegar (as 8 rotas + "Criar cobrança", "Novo cliente"), ② buscar cliente por nome/e-mail (debounce 200ms, top 7, `stagger` só nos 8 primeiros), ③ ações (alternar tema, colapsar sidebar, sair). Sem busca full-text em auditoria/financeiro na v1 — isso é página com filtro, não palette.
- Teclado: `↑↓` move, `Enter` abre, `Esc` fecha, `aria-activedescendant` + `role="combobox/listbox"`. Recentes (últimos 5, `localStorage`) acima dos resultados.

### 3.3 Hierarquia de z-index (tokens, não números soltos)

```css
:root { --z-content: 0; --z-sidebar: 30; --z-topbar: 30; --z-dropdown: 40;
  --z-scrim: 45; --z-drawer: 46; --z-modal: 50; --z-toast: 60; --z-tooltip: 70; }
```

| Camada | z | Regra |
|---|---|---|
| Conteúdo | 0 | — |
| Sidebar / topbar | 30 | Mesmo nível; topbar não cobre sidebar no desktop (lado a lado). No mobile, topbar 30 + botão hamburger abre drawer |
| Dropdown / popover / menu usuário | 40 | Opaco, fecha com click-outside + `Esc`. Um por vez |
| Scrim + drawer mobile | 45 / 46 | Scrim `rgba(0,0,0,0.45)` fade 160ms (só opacidade). Drawer `slideOver` |
| Modal / Command-K | 50 | Sempre acima do drawer. Dropdown interno de modal usa 51, opaco, sem blur extra |
| Toast | 60 | Acima de modal (erro de modal precisa aparecer). Max 3 empilhados |
| Tooltip | 70 | Topo absoluto — tooltip nunca fica atrás de nada |

Proibido: `z-[9999]`, `z-50` solto fora do token, dois modais empilhados (confirmação dentro de modal = troca o conteúdo do modal, não abre outro).

---

## 4. Comportamento

### 4.1 Colapso persistido — onde guardar

- **Cookie + `localStorage`, com papéis distintos.** Cookie `ab_sidebar=expanded|collapsed` (`max-age: 1 ano`, `SameSite=Lax`, path `/`) = lido no **Server Component** do layout para renderizar a largura certa no HTML inicial (sem flash 288→64). `localStorage` `aurum:sidebar-collapsed: "0"|"1"` = espelho no cliente para leitura síncrona antes da hidratação.
- Toggle escreve nos dois + dispara `document.dispatchEvent(new CustomEvent("sidebar:toggle"))` (topbar escuta se precisar). Default: **expandida**. Respeita prop `defaultCollapsed` do layout para testes/SSR.
- Anti-flash: `<html data-sidebar="collapsed">` inline no `head` (script de 5 linhas lê o cookie) + CSS `.sidebar { width: 288px } html[data-sidebar="collapsed"] .sidebar { width: 64px }` antes do JS carregar.
- Nunca guardar no banco/perfil — preferência de máquina, não de conta (operador alterna entre monitor largo e notebook).

### 4.2 Responsivo — breakpoint do drawer

- **Travado: `1024px` (`lg`).** `≥1024px` = sidebar fixa colapsável. `<1024px` = sem sidebar fixa: topbar com hamburger + drawer 320px + scrim. Sem modo intermediário "mini-rail em tablet" (dois comportamentos, não três).
- Drawer mobile: `role="dialog" aria-modal="true" aria-label="Navegação"`, foco vai ao primeiro item ao abrir (após animação, cf. `04 §3.4`), **focus trap** dentro, `Esc`/scrim fecha, swipe-right-para-fechar (`drag="x"`, spring 300/30, threshold 120px). Ao navegar (troca de rota), fecha automaticamente + move foco ao `h1` da página.
- Topbar no mobile: hamburger 40px à esquerda, logo `A` 24px, busca vira ícone (abre Command-K), avatar 32px. Restante colapsa para `…`.

### 4.3 Foco e navegação por teclado

- Sidebar é `<nav aria-label="Navegação principal">` com **roving tabindex**: só o item ativo (ou o primeiro) tem `tabIndex={0}`, demais `-1`. `Tab` entra/sai do bloco inteiro (1 parada, não 8). Dentro: `ArrowDown/ArrowUp` move, `Home/End` extremos, `Enter/Space` navega. Setas `Left/Right` no header colapsam/expandem (`aria-expanded` no botão toggle).
- `Esc` em cascata: tooltip → dropdown/menu → Command-K/modal → drawer. Cada nível devolve foco ao trigger.
- Skip-link obrigatório antes da sidebar: "Pular para o conteúdo" (`sr-only focus:not-sr-only`, leva ao `#conteudo` = `main` com `tabIndex={-1}`).
- Indicador de foco nunca some durante scroll: item focado faz `scrollIntoView({ block: "nearest" })`.

### 4.4 Reduced-motion (e reduced-transparency)

- Root: `<MotionConfig reducedMotion="user">` (já exigido no `04`). Efeitos na sidebar:
  - Colapso 288↔64: `duration: 0` (troca instant, sem animar `width`).
  - Pill `layoutId`: desligada — vira fundo `accent-soft` instant no item ativo (sem spring, sem `layout`).
  - Tooltip/dropdown/drawer/scrim: `duration: 0`, sem slide/fade.
  - Toggle chevron: sem rotate.
  - `prefers-reduced-transparency: reduce`: sidebar/topbar viram `var(--surface-solid)` opaco (mesmo fallback do `@supports`).
- Teste de aceite: com reduced-motion ligado, colapsar 10× seguidas não deve deixar pill órfã nem foco perdido.

---

## 5. Estrutura de rotas do admin (grupos + ícones lucide exatos)

**3 grupos, 8 rotas.** Ordem = frequência de uso do operador (cobrança e financeiro antes de auditoria). Nomes de ícone são `lucide-react` exatos — importar pelo nome citado, `size={20}` (`16` em submenu/footer), `strokeWidth={2}` (ativo `2.25`).

### Grupo 1 — Principal (`aria-label="Principal"`)

| Rota | `href` | Ícone lucide | Badge |
|---|---|---|---|
| Dashboard | `/dashboard` | `LayoutDashboard` | — |
| Clientes | `/clientes` | `Users` | — |
| Cobranças | `/cobrancas` | `ReceiptText` | count de vencidas (`danger`, ex. `12`) — some quando 0 |

### Grupo 2 — Operação (`aria-label="Operação"`)

| Rota | `href` | Ícone lucide | Badge |
|---|---|---|---|
| Financeiro | `/financeiro` | `Landmark` | — |
| Filas | `/filas` | `ListOrdered` | pendentes (`accent`, ex. `5`) → dot no colapsado |
| Produtos | `/produtos` | `Package` | — |

### Grupo 3 — Sistema (`aria-label="Sistema"`)

| Rota | `href` | Ícone lucide | Badge |
|---|---|---|---|
| Auditoria | `/auditoria` | `ScrollText` | — |
| Licenças | `/licencas` | `KeyRound` | `warning` quando expiram em <30d (ex. `3`) |

Footer (fora dos grupos): avatar + nome + menu (`UserRound` Perfil, `SunMoon` Trocar tema, `LogOut` Sair). Toggle colapso: `ChevronsLeft`/`ChevronsRight`. Hamburger mobile: `Menu`, fechar drawer: `X`. Busca: `Search`.

Regras de rota travadas:
1. Ativo = `pathname === href || pathname.startsWith(href + "/")` (detalhe `/clientes/[id]` mantém `Clientes` ativo). Só **um** ativo por vez — detalhe de cobrança vencida não acende dois itens.
2. Label em pt-BR exatamente como na tabela (sem "Gestão de…"). Trunca com ellipsis, `title` nativo proibido (tooltip Radix só no colapsado).
3. Ordem e hrefs acima são o contrato — mudar rota exige atualizar Command-K (§3.2), breadcrumb da topbar e este doc juntos.
4. `aria-label` do link = label + contexto de badge ("Cobranças, 12 vencidas") quando houver count.

---

## Checklist de aceite (UAT da sidebar)

1. Larguras 288/64/320 cravadas; colapso persiste após reload (cookie + localStorage) sem flash.
2. Ativo tem pill `layoutId` + barra 3px + 600 — distinguível sem cor (teste em escala de cinza).
3. Colapsada mostra só ícones + tooltip Radix com delay 400ms + dot de badge; expandida sem tooltip.
4. `<1024px` vira drawer com scrim, trap de foco, `Esc` fecha, navegar fecha e foca o `h1`.
5. Roving tabindex: `Tab` para 1× na sidebar, setas navegam, skip-link funciona.
6. z-index pelos tokens (dropdown 40 < drawer 46 < modal/⌘K 50 < toast 60 < tooltip 70); nenhum `z-9999`.
7. Reduced-motion: tudo instant, sem pill órfã; reduced-transparency: chrome opaco.
8. Command-K abre com `Ctrl/⌘+K`, lista as 8 rotas + 2 criações + 3 ações, `↑↓EnterEsc` funcionam.

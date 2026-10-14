# 03 — Ícones, Sombras e Elevação — Aurum Bit Admin

> Escopo: Next.js 14 Admin. Linguagem: Apple HIG + Liquid Glass (luz de cima, profundidade por blur/translucidez, materiais). Nenhum asset copiado da Apple — apenas princípios (hierarquia, clareza, profundidade) reimplementados com tokens próprios + `lucide-react`.

---

## 1. Sistema de ícones

### 1.1 Biblioteca adotada: `lucide-react`

| Critério | Avaliação |
|---|---|
| Licença | ISC (permissiva, uso comercial OK, sem atribuição obrigatória na UI). Auditável via `pnpm licenses` / `app/globals.css` header. Sem risco de copyleft. |
| Peso | Tree-shakable ESM: importa só o usado (`import { Search } from "lucide-react"`). ~0,5–1 KB por ícone (SVG inline, sem font, sem sprite). Zero request extra. Alternativas descartadas: `react-icons` (bundle agregado, estilos inconsistentes), Heroicons (só 2 pesos, menos cobertura), Phosphor (maior, duotone foge do HIG). |
| Estilo | Outline, 24×24 viewBox, stroke 1.5–2px, `round` caps/joins — o mais próximo open-source de SF Symbols (outline leve, geometria arredondada, legível em 16px). Preenchimento `none`, cor via `currentColor`. |
| A11y/DevX | Props `size`, `strokeWidth`, `aria-hidden`; tipagem TS por ícone; nomes estáveis; funciona em RSC (componente é SVG puro — marcar `"use client"` só no wrapper se houver interatividade). |

Instalação travada: `lucide-react@^0.4xx` (fixar minor no `package.json`), nunca CDN, nunca `lucide` vanilla + `innerHTML`.

### 1.2 Grade, stroke, cantos

- **Tamanhos nominais (caixa do SVG):** `16 / 20 / 24px`. Sidebar nav = `20px`. Ações em tabela/linha densa = `16px`. Header/modal/destaque = `24px`. Não usar 12/14/32 — fora da grade.
- **Stroke:** default **`1.75px`** (meio-termo SF-like). `16px` → `1.5px`; `24px` → `2px`. Nunca <1.25 (some no dark) nem >2.25 (vira sólido). Definir via wrapper, não por ícone avulso.
- **Cantos:** sempre `strokeLinecap="round" strokeLinejoin="round"` (default Lucide — não sobrescrever para `square/miter`).
- **Padding óptico:** ícone 20px dentro de hit-area 44px; manter 2px de respiro interno do glyph (Lucide já entrega). Não aplicar `transform: scale` — trocar `size`.
- **Cor:** herda `currentColor`. Ativo: `--accent`; repouso: `--fg-muted`; destrutivo: `--danger`. Nunca cor fixa hardcoded no SVG.
- **Wrapper único obrigatório** (`components/ui/Icon.tsx`):

```tsx
import { LucideIcon } from "lucide-react";
export function Icon({ icon: L, size = 20, stroke = 1.75, label }: {...}) { ... }
// size ∈ {16,20,24}; <button> ou <span> pai garante 44px (ver 1.3).
```

### 1.3 Áreas de toque ≥ 44px (HIG)

- Todo ícone interativo vive dentro de botão/link com **mínimo 44×44pt** (`.btn-icon { min-width:44px; min-height:44px; display:grid; place-items:center; border-radius:12px; }`).
- Ícone decorativo ao lado de texto (navlink, badge): `aria-hidden="true"`, sem hit-area própria.
- Ícone com ação carrega `aria-label` em pt-BR no **botão**, nunca no SVG (ex. `aria-label="Revelar chave"`, `"Fechar menu"`).
- Espaçamento entre alvos adjacentes ≥ 8px. Em tabelas densas: manter 44px vertical via `padding` da célula, não reduzir botão.
- Foco visível: `outline: 2px solid var(--accent); outline-offset: 2px` no botão (não no SVG).
- `prefers-reduced-motion`: sem animação de ícone (sem spin/pulse) exceto `Loader2` com `animate-spin` — e mesmo assim respeitar a media query.

---

## 2. Inventário de ícones (nomes exatos `lucide-react`)

> Substituir **todos** os emojis atuais de `components/shell/Sidebar.tsx:8-17` (`▦ 👥 🔑 💰 🧾 🔁 🕵️ 📥`) e setas textuais `→/←` (`Sidebar.tsx:72`). Nenhum emoji como ícone após migração.

### 2.1 Navegação (sidebar, `size=20`, `stroke=1.75`)

| Rota / label | Ícone exato | Alternativa vetada |
|---|---|---|
| Painel (`/dashboard`) | `LayoutDashboard` | `Grid`, `Home` (genérico demais) |
| Clientes (`/clientes`) | `UsersRound` | `👥` |
| Usuários (`/usuarios`) | `UserRound` (individual) / `KeyRound` se for acessos | `🔑` sozinho (confunde com licença) |
| Cobranças (`/cobrancas`) | `ReceiptText` | `🧾` |
| Assinaturas (`/assinaturas`) | `Repeat2` | `🔁` emoji |
| Auditoria (`/auditoria`) | `ScrollText` | `🕵️` |
| Financeiro (`/financeiro`) | `Wallet` | `💰` |
| Filas (`/filas`, DLQ) | `Inbox` | `📥` |
| Licenças (`/licencas`) | `KeyRound` | `Key` antigo (usar `KeyRound`) |
| Produtos (`/produtos`) | `Package` | `Box` (legado) |

Colapso sidebar: `ChevronsLeft` / `ChevronsRight` (substituem `→/←` textuais).

### 2.2 Ações (nomes exatos)

| Ação | Ícone exato | Uso / nota |
|---|---|---|
| Revelar / ocultar segredo | `Eye` / `EyeOff` | `LicenseKeyMasked.tsx` — toggle; label "Revelar chave" / "Ocultar chave" |
| Renovar (licença) | `RotateCcw` | `RenewDialog.tsx`; `RefreshCw` reservado a "recarregar dados" (`StaleBanner` retry) |
| Revogar (licença) | `Ban` | `RevokeDialog.tsx`; nunca `Trash2` (não é exclusão) |
| Exportar | `Download` | `BillingExportButton`, `ExportButton` (finance); `FileDown` só se houver escolha de formato |
| Copiar | `Copy` (+ `Check` após cópia, 1,5s) | Chave/JSON (`MaskedJson.tsx`); feedback via `Check`, não toast |
| Buscar | `Search` | `SearchCmdk.tsx`; atalho `⌘K` em texto, não no ícone |
| Fechar | `X` | `MobileDrawer.tsx`, modais, drawers (`TraceabilityDrawer`) |
| Adicionar / remover | `Plus` / `Minus` | `size=16` em steppers; botão 44px mantido |
| Setas navegação | `ChevronLeft`, `ChevronRight`, `ChevronDown`, `ArrowRight`, `ArrowUpRight` | Paginação, breadcrumbs, links externos (`ArrowUpRight`) |
| Menu / sino / conta | `Menu`, `Bell`, `CircleUserRound` | `Header.tsx`, `NotificationsBell.tsx`, `AccountMenu.tsx` |
| Estados | `TriangleAlert` (era `AlertTriangle`), `Info`, `CircleCheck` (era `CheckCircle2`), `CircleX`, `Loader2` | `EmptyState`, `ErrorState`, `ForbiddenState`, `StaleBanner` — nunca emoji ⚠️/⛔ |
| Calendário / org | `CalendarDays`, `Building2`, `ArrowLeftRight` | `TimezoneBadge`, `OrgSwitcher` |

Regra: **1 ação = 1 ícone** em todo o admin. `RefreshCw` ≠ `RotateCcw`; `Download` ≠ `Upload`; não improvisar sinônimo por tela.

---

## 3. Sistema de sombras / elevação (níveis 0–4)

Princípio Liquid Glass: elevação = **sombra neutra curta + blur de material + highlight superior inset**. A luz vem sempre de cima; o fundo desfocado atrás do vidro vende a profundidade, não uma sombra gigante.

### 3.1 Tokens (colar em `app/globals.css`)

```css
:root {
  /* blur do material por nível */
  --glass-blur-1: 8px;
  --glass-blur-2: 16px;
  --glass-blur-3: 24px;
  /* saturação do backdrop (vidro) */
  --glass-sat: saturate(180%);

  /* highlight superior — fio de luz no topo da borda (glass) */
  --glass-hi-light: inset 0 1px 0 0 rgb(255 255 255 / 0.55);
  --glass-hi-dark:  inset 0 1px 0 0 rgb(255 255 255 / 0.12);

  /* LIGHT — sombras neutras, alfa baixo */
  --elev-0: none;
  --elev-1: 0 1px 2px rgb(16 24 40 / 0.06), 0 1px 3px rgb(16 24 40 / 0.08);
  --elev-2: 0 2px 4px rgb(16 24 40 / 0.08), 0 8px 24px -8px rgb(16 24 40 / 0.22);
  --elev-3: 0 4px 8px rgb(16 24 40 / 0.08), 0 20px 44px -12px rgb(16 24 40 / 0.30);
  --elev-4: 0 6px 12px rgb(16 24 40 / 0.10), 0 28px 56px -12px rgb(16 24 40 / 0.36);

  /* DARK — mesma geometria, alfa maior + highlight acompanha */
  --elev-0-d: none;
  --elev-1-d: 0 1px 2px rgb(0 0 0 / 0.45), 0 2px 6px rgb(0 0 0 / 0.35);
  --elev-2-d: 0 2px 6px rgb(0 0 0 / 0.50), 0 12px 32px -8px rgb(0 0 0 / 0.60);
  --elev-3-d: 0 4px 12px rgb(0 0 0 / 0.50), 0 24px 56px -12px rgb(0 0 0 / 0.65);
  --elev-4-d: 0 8px 16px rgb(0 0 0 / 0.55), 0 32px 72px -12px rgb(0 0 0 / 0.70);
}
[data-theme="dark"] {
  --elev-1: var(--elev-1-d); --elev-2: var(--elev-2-d);
  --elev-3: var(--elev-3-d); --elev-4: var(--elev-4-d);
  --glass-hi: var(--glass-hi-dark);
}
:root, [data-theme="light"] { --glass-hi: var(--glass-hi-light); }
```

Composição por nível (sombra + material + highlight):

| Nível | `box-shadow` | `backdrop-filter` (se translúcido) | Highlight | Quando usar |
|---|---|---|---|---|
| **0 — Rest** | `none` | `none` | nenhum | Linha de tabela, item de lista, sidebar fixa, conteúdo plano. |
| **1 — Card** | `var(--elev-1)` | `blur(var(--glass-blur-1))` **só** se card for glass sobre imagem/mapa; card sólido (opaco) usa sombra pura, sem blur | `var(--glass-hi)` **só** em card glass; card sólido: `border: 1px solid var(--border)` | KPI cards, painéis, `ProjectionChart`, tabelas contidas. |
| **2 — Dropdown / Popover** | `var(--elev-2)` | `blur(var(--glass-blur-2)) var(--glass-sat)` + fundo `rgb(... / 0.75)` | `var(--glass-hi)` sempre | `AccountMenu`, `OrgSwitcher`, `SearchCmdk` resultados, menus de ação, tooltips. Fecha em `Esc`/clique-fora. |
| **3 — Modal / Drawer** | `var(--elev-3)` | Overlay `rgb(0 0 0 / 0.40)` + `blur(4px)` **no overlay**; superfície do modal `blur(var(--glass-blur-3))` | `var(--glass-hi)` sempre | `RefundDialog`, `CancelSubscriptionDialog`, `RenewDialog`, `RevokeDialog`, `TraceabilityDrawer`. Foco preso, `aria-modal`. |
| **4 — Toast / Banner flutuante** | `var(--elev-4)` | `blur(var(--glass-blur-3)) var(--glass-sat)` | `var(--glass-hi)` sempre | Toasts, `StaleBanner` flutuante. Duração 4–6s, nunca bloqueia ação. |

Notas:
- `backdrop-blur` exige fundo translúcido (`color-mix` / `/ 0.7–0.8`); blur sobre fundo opaco é placebo — proibido (ver §4).
- Sombras atuais hardcoded em `globals.css:613,627,673` (`rgba(232,179,75,.35)` dourada, pretos 0.45/0.5 avulsos) **migrar** para os tokens acima; sombra dourada sai (ver regra 1).
- Raio da superfície acompanha a elevação: L1 `12px`, L2 `14px`, L3 `16–20px`, L4 `14px` (pílula em toast pequeno OK). Vidro com raio 0 não existe.

### 3.2 Exemplo canônico (card glass + dropdown)

```css
.glass-card {
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  backdrop-filter: blur(var(--glass-blur-2)) var(--glass-sat);
  -webkit-backdrop-filter: blur(var(--glass-blur-2)) var(--glass-sat);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--elev-1), var(--glass-hi);
}
.glass-pop {
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  backdrop-filter: blur(var(--glass-blur-2)) var(--glass-sat);
  border-radius: 14px;
  box-shadow: var(--elev-2), var(--glass-hi);
}
```

---

## 4. Regras travadas (proibições explícitas)

1. **Nunca sombra colorida** (marca, dourado `#E8B34B`, sucesso/erro tingindo `box-shadow`). Exceção única: anel de foco `0 0 0 3px color-mix(accent 30%, transparent)` — que é acessibilidade, não elevação. Glow colorido em card/botão = vetado.
2. **Raio coerente com blur:** `blur(px) ≤ raio(px)` aprox. (ex. blur 24px exige raio ≥ 16px). Vidro quadrado com blur alto vaza luz na quina — revisar em review visual.
3. **Máximo 2 camadas de sombra** por `box-shadow` (+ 1 inset de highlight). Três sombras externas empilhadas = achatar para o token do nível acima.
4. **Sem `backdrop-blur` sem translucidez** e sem `-webkit-` ausente (Safari exige prefixo — sempre declarar os dois).
5. **Nenhum emoji como ícone** (sidebar, estados, botões). Nenhuma seta textual (`→ ← ×`) como ícone — usar Lucide.
6. **Nada de assets copiados da Apple** (SF Symbols, wallpapers, blur de referência, ícones do sistema). Lucide + CSS próprio apenas.
7. **Sombras só nos 5 tokens** (`--elev-0…4`). Valor avulso em `box-shadow` fora deles falha no lint de design (`stylelint` token-check ou grep em CI).
8. **Elevação não transmite estado:** erro/sucesso = cor do texto/borda + ícone de estado, nunca sombra vermelha/verde maior.
9. **`prefers-reduced-transparency` / `prefers-reduced-motion`:** reduzir blur para `4px` e desligar animações de entrada de modal/toast; elevação cai 1 nível no modo reduzido.
10. **Performance:** `backdrop-blur > 24px` proibido; no máximo 2 superfícies com blur por viewport (modal + dropdown contam — fechar um antes de abrir outro quando possível). Listas longas usam superfície opaca L0/L1, nunca glass por linha.

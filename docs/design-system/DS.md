# Aurum DS v1 — regras travadas (fonte única)

> Síntese arbitrada de `.planning/design/01–08` + `CRITICA-A/B/C`.
> Conflito? **Este arquivo manda.** Mudança aqui exige proposta + revisão dos 3 eixos.
> Escopo v1: dark + light (tokens prontos, toggle no ar), P0 funcional, sem Command-K,
> sem carrossel/janelas, sem Radix, sem toast-sistema (inline apenas), sem submenu.

## 1. Tokens (fonte única — 01 manda nos valores)

```css
:root, [data-theme="light"] {
  --bg-0: #e7e9ee; --bg-1: #f4f5f7; --bg-2: #ffffff;
  --text-1: #14161a; --text-2: rgba(20,22,26,.68); --text-3: rgba(20,22,26,.48);
  --border-1: rgba(20,22,26,.08); --border-2: rgba(20,22,26,.16); --border-3: rgba(20,22,26,.32);
  --accent: #8a5e0e; --accent-strong: #8a5e0e; --accent-ink: #ffffff; --accent-soft: rgba(138,94,14,.12);
  --brand-gold: #e8b34b; /* marca/fundo com tinta, nunca texto funcional */
  --danger: #c92a30; --danger-ink: #ffffff; --danger-soft: rgba(201,42,48,.12);
  --ok: #157f46; --ok-ink: #ffffff; --ok-soft: rgba(21,127,70,.12);
  --warn: #8a5e0e; --warn-soft: rgba(138,94,14,.14);
  --info: #0b6bcb; --info-soft: rgba(11,107,203,.12);
  --ring: #8a5e0e;
  --scrim: rgba(20,22,26,.6);
  --shadow-1: 0 1px 2px rgba(20,22,26,.08);
  --shadow-2: 0 4px 16px rgba(20,22,26,.12);
  --shadow-3: 0 12px 40px rgba(20,22,26,.22);
  --specular: inset 0 1px 0 rgba(255,255,255,.5);
}
.dark, [data-theme="dark"] {
  --bg-0: #0b0d10; --bg-1: #0f1115; --bg-2: #171b22;
  --text-1: #f2efe6; --text-2: rgba(242,239,230,.68); --text-3: rgba(242,239,230,.44);
  --border-1: rgba(255,255,255,.08); --border-2: rgba(255,255,255,.14); --border-3: rgba(255,255,255,.24);
  --accent: #e8b34b; --accent-strong: #e8b34b; --accent-ink: #1a1405; --accent-soft: rgba(232,179,75,.14);
  --brand-gold: #e8b34b;
  --danger: #f2555a; --danger-ink: #1a0505; --danger-soft: rgba(242,85,90,.12);
  --ok: #3ec97f; --ok-ink: #06130c; --ok-soft: rgba(62,201,127,.12);
  --warn: #e8b34b; --warn-soft: rgba(232,179,75,.14);
  --info: #5eb1ef; --info-ink: #06121f; --info-soft: rgba(94,177,239,.12);
  --ring: #e8b34b;
  --scrim: rgba(0,0,0,.6);
  --shadow-1: 0 1px 2px rgba(0,0,0,.4);
  --shadow-2: 0 4px 16px rgba(0,0,0,.45);
  --shadow-3: 0 12px 40px rgba(0,0,0,.5);
  --specular: inset 0 1px 0 rgba(255,255,255,.08);
}
```

**Travas:** funcional só com token ≥4.5:1; `--text-3` proibido p/ funcional; warn/danger sempre com cue não-cor (ícone/texto); sem sombra colorida (só anel de foco).

**Ícones de plataforma (exceção aos ícones genéricos — rev. 2026-10-17):** o §4
trava `lucide-react` como biblioteca canônica. Isso **vale para ícones de UI**
(ação, navegação, estado). Para **ícone de plataforma de produto** — Windows,
macOS, Linux, Web, Apple — usa-se o bitmap de marca, porque o nome da plataforma
é a informação e um ícone genérico (`Monitor` para Windows e macOS, `Cpu` para
Linux) **confunde o usuário em vez de informá-lo**. Regras:

- Catálogo (ids, rótulos, monocromia, arquivo de arte): **fonte única**
  `libs/contracts/src/products.catalog.json` — `pnpm catalog:sync` deriva os tipos
  do contrato/API/admin/portal e `tools/build-tag-icons.py` lê o MESMO JSON para
  gerar `apps/{admin,portal}/public/tags/<id>.png` (256px RGBA, id = o mesmo slug
  gravado em `products.platforms`). **Nunca editar o PNG gerado nem lista de
  plataforma à mão**: editar o JSON e rodar `pnpm catalog:sync` (o CI reprova drift
  e ícone órfão com `pnpm catalog:check`).
- Apple é a única marca monocromática: tem variante `-dark` (invertida) porque a
  marca preta some em `--bg-0`. Os demais não têm variante.
- Sempre **decorativo** (`alt=""`) com o rótulo pt-BR em texto ao lado: a
  informação nunca pode depender de reconhecer o logo.
- O bitmap **não** traz status nem valence — nunca usar para estado/alerta (esse
  segue `lucide-react` + cue não-cor).
- Licença de marca é exposição de terceiros do cliente final; usar apenas nas
  plataformas efetivamente suportadas pelo produto.

## 2. Blur (valor único — resolve A1)

| Superfície | Material | Backdrop |
|---|---|---|
| Card/app | opaco (`--bg-1`) | — |
| Sidebar/topbar (chrome) | 50% + `blur(24px) saturate(1.6)` + specular | fallback sólido |
| Modal/drawer | opaco + scrim `--scrim` | **sem blur** |
| Dropdown/menu | opaco `--bg-2` + `--shadow-2` | — |
| Tooltip (title-only v1) | nativo | — |

Proibido blur em: inputs, tabela densa, badge, texto <13px, toast-inline. Máx 2 superfícies com blur por viewport. `reduced-transparency` → tudo sólido.

## 3. Tipografia (02, com pisos da B)

Escala (rem, root 16px): `title-auth 1.35/700`, `title-page 1.25/700`, `section 1.06/700`, `headline 0.94/600`, `body 0.94/400`, `callout 0.85`, `caption 0.8`, `micro 0.75/600` (piso 12px), `kpi 1.6/700 mono`, `mfa-code 1.4 mono`. Pesos só 400/600/700 (+800 logo). `th` = 12.5px/700 uppercase. Dinheiro/IDs/MFA/JSON sempre mono + `tabular-nums`, coluna à direita, nunca truncar. Erro usa `#ff9a9e`(dark)/`--danger`(light). Sem `maximum-scale=1`.

## 4. Ícones (03 canônica — resolve A5)

`lucide-react`, 16/20/24px, stroke 1.75 (1.5 em 16px, 2 em 24px), `currentColor`, wrapper `Icon`. Toque ≥44px (ícone 20px em botão 44px). Sidebar: LayoutDashboard, Users, ReceiptText, Landmark, ListOrdered, Package, ScrollText, KeyRound (+ colapso ChevronsLeft/Right, sino Bell, usuário CircleUserRound). Ações: Eye/EyeOff, RotateCcw, Ban, Download, Copy/Check, Search, X, Plus/Minus, Menu, TriangleAlert/Info/CircleCheck/CircleX/Loader2. Sem emoji na UI. Decoração `aria-hidden`, interativo com `aria-label` pt-BR.

**Bitmap de plataforma é a exceção conhecida (rev. 2026-10-17):** ícone que **nomeia a
plataforma** do produto (Windows/macOS/Linux/Web/Apple) usa o bitmap de `public/tags/`,
não `lucide-react` — ver §1. As demais regras desta seção (44px, `currentColor` p/
genérico, aria) seguem válidas.

## 5. Elevação + sombras (01 manda — resolve A1/B7)

Níveis: L0 tabela (sombra 0), L1 card (`--shadow-1`, raio 14), L2 menu (`--shadow-2`, raio 12), L3 modal/drawer (`--shadow-3`, raio 16–20). Máx 2 sombras + 1 inset por elemento. Raios: 8 pequeno, 10 base, 14 card, 18 modal.

## 6. Motion (04, com vetos A4/B8)

Durações 100/160/240/360ms (teto 400, saída = 75% da entrada). Easings: `out(0.16,1,0.3,1)` entrada, `in-out` transição, `in` só saída, linear só progresso. Spring SÓ: toggle, whileTap (.97), drawer-drag. **Nunca**: width/height/top/left (colapso sidebar = instant + crossfade), bounce, count-up de saldo, stagger >20, rise de página, shake default (opt-in em erro MFA). `<MotionConfig reducedMotion="user">`; `layoutId` SÓ pill sidebar + tab-underline. Foco move **síncrono** (nunca pós-animação); ring 100ms só `:focus-visible` + `forced-colors` adjust.

## 7. z-index (tabela única — resolve A2)

`sidebar/topbar 30` · `dropdown/menu 40` · `drawer 46` · `modal 50` · `toast-sistema (inexistente v1)` · `tooltip 70`. Nada fora da tabela.

## 8. Sidebar (05, com cortes)

288px/64px, item 44px pitch, grupo `12px/700 uppercase text-2`, pill ativa `layoutId` + barra 3px accent, badge 20px/99+/dot 8px colapsado, tooltip só colapsado (title nativo v1), colapso em cookie `ab_sidebar` + localStorage, drawer ≤1024px, roving tabindex + setas/Home/End + Esc, skip-link. **Sem submenu, sem Command-K, sem animação de width** (v1).

## 9. Componentes P0 (forma final)

- **Button**: `primary | secondary | destructive | ghost(com borda) | icon(44px)`; `lg 48px / md 44px / sm 36px (restrito)`; `whileTap .97`; disabled + `title`; destrutivo em 2 passos.
- **Field/Input**: label 600 + input opaco 44px + hint + erro inline (`role=alert`); Password (mostrar/ocultar), CodeInput (mono, auto-submit 6).
- **Table+Pager**: `th` padrão §3, zebra não, linha hover, selected dourado, cursor-pagination, empty/error/stale dedicados, KPI parcial proibido (avisar teto).
- **Dialog**: tamanho único md, header/body/footer, foco inicial, Esc, backdrop scrim, trava em pending.
- **Badge**: soft opaco + ícone; **Toast-sistema não existe** (sucesso = inline).
- Carrossel/janelas/Radix: **fora da v1**.

## 10. Tailwind (arquitetura — 07)

`darkMode:'class'` + `<html class="dark" data-theme>` default dark; `ThemeProvider` sincroniza `ab_theme` no mount (flash só p/ light — aceito; script inline quebra o prerender do Next 14.2.5, testado). Cores 100% via `var(--*)`; `dark:` só estrutural. `cn()` = clsx+tailwind-merge. Proibido valor arbitrário fora dos tokens (grep em CI). Migração: fundação → auth → átomos → shell → limpeza; legado convive até o fim.

## 11. Anti-mock (fatiado — 08 + cortes C)

Flags por domínio (`API_INTERNAL_URL` global + por-rota), ordem: auth → finance-leitura → billing/audit-leitura → licenças/DLQ-leitura → escritas 1-a-1; 502 nunca stub silencioso; `auth/me` pré-requisito duro; DLQ path real `/v1/admin/dlq` + `mode:logical` exposto; settle exige seletor `account_id` + 422.

## 12. Definição de PRONTO v1

`tsc` + build verdes; login→MFA→dashboard sem mock (flag ligada) e com mock (flag off); 44px/foco/contraste auditados por tela; light/dark com flash só no light; RAG do DS (`query.js "botão primário"`) responde com fonte.

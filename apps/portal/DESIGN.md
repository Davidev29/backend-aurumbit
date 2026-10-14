# AurumBit DESIGN.md — fonte única de verdade visual

Propósito: programas prontos para empresas que funcionam mesmo sem internet.
Promessa em 1 frase: "pague uma vez, use offline, sem surpresa na conta."

## Tom PT-BR

Simples, direto, sem jargão. Frases curtas. Verbos de ação.
Ex: "Funciona sem internet" ✅ / "Solução SaaS resiliente edge-first" ❌
Microcopy de preço: "1 computador", "100% offline", "ajuda prioritária".
Labels de ação dizem o que acontece: "Ver planos e preços" ✅ / "Começar agora" só
após o preço (pós-`#produtos`).

## Paleta (canônica — usar via `var(--*)`, nunca hex solto)

| Token | Valor | Papel |
|---|---|---|
| `--bg-0` / `--bg-1` / `--bg-2` | `#050507` / `#0B0B0E` / `#121218` | fundo / superfície / card-vidro |
| `--text-1` / `--text-2` / `--text-3` | `#F5F5F4` / `#8E8E93` / `#8A8A8E` | primário / secundário / terciário (só decorativo) |
| `--gold-700` / `--gold-500` / `--gold-300` / `--gold-200` | `#755D2E` / `#C0A060` / `#D8B879` / `#EADAB6` | primitive ouro (base → ponta do gradiente) |
| `--accent` / `--accent-strong` / `--accent-soft` | ouro 500 / 300 / 14% | ação primária / ênfase / wash |
| Light mode `--accent` | `#755D2E` | contraste ≥ 4.5:1 sobre branco (nunca ouro claro cru no light) |
| Estados | ok `#4ADE80` / danger `#F87171` / info `#60A5FA` | semânticos, nunca decorativos |

Accent budget (ui-craft): **1 acento, 3–5 placements por viewport acima da dobra**
(CTA primário, 1 métrica-chave, estados ativos). Glow ouro **só** em CTA primário e foco.

## Tipografia

- Display: Space Grotesk 700 (H1/H2). H1 `text-hero-md` fluid; H2 `text-section`
  (`clamp(1.75rem,4vw,2.5rem)`) — H1 > H2 sempre.
- Corpo: Inter 400/500 (`text-body` 0.94rem/1.5). Números/preço: JetBrains Mono +
  `tabular-nums`.
- Acento: Playfair Display italic — **só** no logo "AurumBit". Proibido em títulos/corpo.
- Sentence case em PT-BR. Eyebrow (`badge-gold`) no máximo 1 a cada 3 seções.

## Radius / sombra / motion

- Radius: sm 8 (badge) · base 10 (btn/input) · card 14 · modal 18. Exceção canônica: badge/pill/tab/filter-chip = 999px. Nada mais fora disso.
- Sombra padrão: `shadow-2` + `specular` inset. Hover de card = `translateY(-2px)` +
  `border-line3`, sem glow.
- Micro 150ms ease-out · modal 300ms scale-in · entrada de seção 500ms
  `cubic-bezier(0.16,1,0.3,1)`. **1 entrada por viewport, sem stagger em cadeia.**
  Contínuo permitido: 1 camada ambiente (orbes 16–22s). `prefers-reduced-motion`,
  `prefers-reduced-transparency` e `forced-colors` sempre respeitados.
- Componentes: `btn-primary` = gradiente ouro 135° + texto `accent-ink`, sem shine sweep.
  `glass-card` = bg-2 50% + blur 20 + borda `border-2`. `section-py` 64/96/128px,
  container 80rem, `scroll-margin-top` 76px, foco só `:focus-visible`, alvos ≥ 44px.

## Tema

Dark premium é a identidade; o shell respeita o sistema (`next-themes`,
`defaultTheme: system`, toggle Sol/Lua no Navbar — 2026-10-13). Tokens light são
intencionais (accent escurecido para contraste). Classe `.dark` legada mantida por
compatibilidade com `dark:` do Tailwind.

Transição de tema (2026-10-14): `lib/theme-transition.ts` orquestra reveal
circular via View Transitions a partir do toggle (~1050ms), com fallback
`.theme-animating` (950ms conteúdo / 1100ms fundos grandes, expo-out, só tinta:
bg/border/color/fill/stroke/box-shadow — nunca transform/opacity/filter, nunca
`transition: all`). Duração longa de propósito: a troca é fluxo, não corte. Ícone Sol/Lua só
transform+opacity (compositor). `prefers-reduced-motion`/`forced-colors` = corte
seco. `dark:` do Tailwind resolve via `[data-theme="dark"]`; `.dark` segue
espelhada pelo `ThemeClassSync`.

Transição em vidro (2026-10-14, v6 — substitui o burn): `lib/theme-glass.ts`
orquestra véu fosco denso (450ms ease, backdrop-blur 24px + saturate,
`data-on`) sobre o tema antigo → `startViewTransition(setTheme)` com reveal
circular do botão (1200ms ease-in-out, arranque suave anti-clarão) →
assentamento (500ms SÓ após o reveal: o véu derrete devagar e a promessa só
resolve em seguida, sem corte seco no final). Desenho
anti-clarão: a troca claro↔escuro nunca ocorre num corte visível — sempre
sob o vidro, sem piscadas fullscreen. Sem canvas, sem partículas, sem glow,
sem camada colorida: só vidro. Promessa resolve em ~2150ms; lock cobre tudo.
`aria-pressed` reflete o tema final (estado `committed` no toggle).
`forced-colors`/`reduced-transparency` cortam até o VT. Kill-switch:
`NEXT_PUBLIC_THEME_GLASS=0`. Rollout: só `/`. Sem VT → legado.
Rollout: só `/`. Sem VT → legado, canvas nem sobe.

## NUNCA fazer

1. Hex solto fora de `var(--*)` · 2. Playfair fora do logo · 3. >1 glow/seção ·
2. CTA < 44px · 5. Animar `filter/blur` no scroll · 6. Ouro claro sobre fundo claro ·
3. Radius fora de 8/10/14/18 · 8. Jargão técnico em copy visível ·
4. Seção nova sem âncora + `scroll-margin` · 10. `transition: all` (listar propriedades).

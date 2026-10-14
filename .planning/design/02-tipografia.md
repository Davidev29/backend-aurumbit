# 02 — Tipografia — Terminal Admin Aurum Bit

> Decisão-mãe: **hierarquia por peso + tamanho, nunca só por cor.** Segue Apple HIG (SF-like, Dynamic Type mental) sem importar webfont. Admin denso, dark, pt-BR. Base travada, sem `text-xs/sm/base` ad hoc.

Estado atual auditado (`apps/admin/app/globals.css`): `body { system-ui; 15px; lh 1.5 }`, tamanhos soltos (`1.6rem` KPI, `0.78rem` badge, `0.8rem` foot, `1.35rem` h1 auth, `1.4rem` code-input), mono só em `.mono`. Problema: ~10 tamanhos sem token, `th` 600 cinza (hierarquia por cor — viola a regra), sem `tabular-nums` no financeiro.

---

## 1. Stack de fontes (zero webfont)

**Decisão: NENHUMA webfont (nada de Inter/Google Fonts).** Motivos: admin interno dark, offline-first, LGPD (sem ping externo), FOUT em KPI/tabela é inaceitável, `system-ui` no macOS = SF, no Windows = Segoe UI — já é o "SF-like" pedido. Inter só se um dia virar produto público — hoje é custo sem retorno.

```css
:root {
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont,
    "SF Pro Text", "SF Pro Display", "Segoe UI",
    Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "Cascadia Mono",
    "JetBrains Mono", Consolas, Menlo, monospace;
}
body { font-family: var(--font-sans); font-size: 0.9375rem; /* 15px */ line-height: 1.5; }
```

Fallback: a ordem acima já cobre macOS → Windows → Linux → Android. `BlinkMacSystemFont` é obrigatório (Chrome macOS não pega `-apple-system` sozinho). Emoji: deixa o sistema resolver, não lista na stack.

**Mono — uso OBRIGATÓRIO para:** valores monetários em KPI e tabelas, IDs/UUIDs, chave manual MFA (`secret`), `code-input`, JSON mascarado (`.masked-json`), datas com hora em auditoria/rastro. Nunca usar mono em texto corrido, labels ou navegação.

```css
.mono, .kpi-value[data-kind="currency"], td[data-numeric] {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
}
```

---

## 2. Escala travada (única fonte de verdade)

Root `html { font-size: 16px; }`. Todos os tamanhos em `rem`. **Pesos permitidos: 400 / 600 / 700 — e 800 SÓ no logo `A`.** Nada de 500 (Segoe não tem 500 decente, vira faux-bold). Hierarquia = tamanho + peso, cor só repete o que peso/tamanho já disse.

| Token | px / rem | Peso | LH | LS | Uso canônico |
|---|---|---|---|---|---|
| `title-auth` | 21.6px / 1.35rem | 700 | 1.25 | −0.01em | `h1` login ("Bem-vindo de volta") e MFA ("Ative o autenticador"). Substitui o `1.35rem` solto de `.auth-card h1`. |
| `title-page` | 20px / 1.25rem | 700 | 1.3 | −0.01em | `h1` interno com `margin:0` ("Painel", "Financeiro", "Cobranças"). É o `h1` de `.toolbar`. |
| `title-section` | 17px / 1.0625rem | 700 | 1.35 | −0.005em | Título de card relevante, título de dialog/drawer, `.feedback h2`. |
| `headline` | 15px / 0.9375rem | 600 | 1.45 | 0 | Label de campo (`.field label`), tab ativa, item de menu, `th` de tabela, botão primário. |
| `body` | 15px / 0.9375rem | 400 | 1.5 | 0 | Texto corrido, `td`, input/select, descrição auth (`.muted` abaixo do h1), passos MFA. **Corpo padrão.** |
| `callout` | 13.6px / 0.85rem | 400 | 1.5 | 0 | `kpi-label`, hint de KPI, placeholder, `summary` do `<details>`, filtro `label`. Hoje é `0.85rem` — vira token. |
| `caption` | 12.8px / 0.8rem | 400 | 1.45 | +0.01em | Rodapé auth (`.auth-foot`), toggle "Mostrar/Ocultar", saldo do período, timezone badge. |
| `micro` | 12.5px / 0.78rem | 600 | 1.4 | +0.02em | **SÓ** badge (`.badge`), uppercase opcional. Piso absoluto (ver §3). |
| `kpi-currency` | 25.6px / 1.6rem | 700 + mono + tnum | 1.2 | 0 | Valor de KPI monetário. Mantém o `1.6rem` atual mas troca sans→mono. |
| `kpi-number` | 25.6px / 1.6rem | 700 sans + tnum | 1.2 | 0 | Valor de KPI contável (licenças, clientes). Sans porque `toLocaleString` com mono quebra ritmo de leitura em 4+ dígitos — exceção opinativa. |
| `code-mfa` | 22.4px / 1.4rem | 600 mono | 1.3 | +0.5em + `text-indent: 0.5em` | Input de 6 dígitos. Mantém `letter-spacing` atual (é o único lugar com tracking largo). |
| `brand` | 16.8px / 1.05rem | 800 | 1.2 | +0.02em | `auth-brand-name` e `brand-text` da sidebar. 800 proibido em qualquer outro lugar. |
| `brand-sub` | 13.1px / 0.82rem | 400 | 1.4 | 0 | `auth-brand-sub` ("Terminal administrativo"). |

O que MORRE na migração: `0.88rem` (summary → `callout`), `0.92rem` (td → `body`), `1rem` de `.input-lg/.btn-lg` (vira `body` com padding maior, não fonte maior — input grande por padding, não por glyph), `1.05rem` solto (vira `brand`).

CSS sugerido (colocar no `globals.css`, seção `/* type scale */`):

```css
html { font-size: 16px; }
h1.auth-title { font-size: 1.35rem; font-weight: 700; line-height: 1.25; letter-spacing: -0.01em; }
h1.page-title { font-size: 1.25rem; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; margin: 0; }
.kpi-value { font-size: 1.6rem; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
.kpi-label { font-size: 0.85rem; line-height: 1.5; }
table.data { font-size: 0.9375rem; }
table.data thead th { font-size: 0.9375rem; font-weight: 600; }
.badge { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.02em; }
.code-input { font-size: 1.4rem; letter-spacing: 0.5em; text-indent: 0.5em; }
```

---

## 3. Regras duras

### 3.1 Truncar vs. quebrar (sem meio-termo)
- **Trunca com `ellipsis` (1 linha):** `navlink-label`, `brand-text`, nome de cliente em linha de tabela, e-mail em célula, categoria em filtro. Sidebar colapsada esconde, não empilha — já está certo, manter.
- **Quebra (`wrap`, nunca corta):** mensagens de erro (`.form-error`), descrição auth, `hint` de KPI, rastro/auditoria, `masked-json` (`white-space: pre-wrap; word-break: break-word` — já certo).
- **Nunca trunca:** valores monetários, código MFA, chave manual, botões, tabs. Dinheiro cortado = bug crítico, não estilo.
- Utilitário padrão: `.truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }` — aplicar em nav + células de nome.

### 3.2 Números tabulares no financeiro (obrigatório)
Todo valor monetário, contagem de KPI, coluna de tabela numérica e saldo do período **TEM** `font-variant-numeric: tabular-nums` (+ `font-feature-settings: "tnum" 1` para Segoe/Consolas antigas). Sem isso, `R$ 48.230,00 → R$ 9.100,00` dança horizontalmente a cada refresh do KPI e a coluna "Valor" fica serrilhada. Alinhamento: coluna monetária sempre `text-align: right`, coluna data/hora `left` + mono 0.85em, coluna status `center` (badge). `formatBRL` continua dono do `pt-BR` (`R$ 1.234,56`); a fonte só garante largura fixa.

### 3.3 Tamanhos mínimos e Dynamic Type
- **Piso: 11px.** Nada abaixo de `micro` (12.5px). `.auth-foot` hoje em `0.8rem` (12.8px) OK; proibido criar `10px` para "caber mais coluna" — coluna que não cabe em 12.5px deve truncar ou ir para drawer, não encolher fonte.
- `prefers-reduced-motion` já respeitado; somar `text-size-adjust: 100%` e nunca desabilitar zoom (`maximum-scale=1` proibido no viewport). Contraste resolve legibilidade, não zoom bloqueado.
- Teste de aceite: com root a 200% (browser zoom), layout quebra por scroll, nunca por sobreposição de texto.

### 3.4 Contraste por nível (dark atual)
- `body` / títulos / valores (`--text` sobre `--bg`): ≥ 7:1 — nível AAA, intocável.
- `callout`/`caption`/`muted` (`--text-dim #a7adbb` sobre `--bg #0f1115`): calcular e **garantir ≥ 4.5:1**. Se o audit do design-01 escurecer o bg, re-testar `--text-dim` primeiro — texto pequeno claro em bg mais escuro costuma passar, o risco é `caption` sobre `bg-softer` em card (contraste menor). Regra: `muted` NUNCA em `micro` — micro é sempre 600 com cor de badge (accent/borda), nunca `--text-dim`.
- Erro (`.form-error`): `--danger` puro sobre bg escuro falha AA em 15px — usar `#ff9a9e` (já usado em `.btn-danger`) para texto de erro, reservando `--danger` para borda/ícone.
- Hierarquia por peso (reforço): `th` continua `--text-dim` MAS com 600 em `body` 15px contra `td` 400 — a distinção é o peso, a cor só acompanha. Nunca criar variação de cor sem variação de peso/tamanho correspondente.

---

## 4. Mapeamento — do atual para a escala

| Onde (arquivo / classe) | Hoje | Vira |
|---|---|---|
| Login `h1` "Bem-vindo de volta", MFA `h1` | `.auth-card h1` 1.35rem sem peso explícito (herda UA ~700) | `title-auth` 21.6px/700 |
| Descrição abaixo do h1 auth | `.muted` herda 15px | `body` 15px/400 muted (manter) |
| `label` E-mail/Senha/Código | `.field label` 600 sem size | `headline` 15px/600 |
| Input/button grandes | `.input-lg/.btn-lg` 1rem | `body` 15px + padding (sem step de fonte) |
| Toggle Mostrar/Ocultar | `.password-toggle` 0.8rem | `caption` 12.8px/400 |
| Rodapé "Protegido por…" | `.auth-foot` 0.8rem | `caption` (manter valor, trava token) |
| Passos MFA `ol` | `.mfa-steps` herda 15px | `body` 15px/400 muted |
| Chave manual `summary` | `.manual-key summary` 0.88rem | `callout` 13.6px/400 |
| Chave manual valor + botão Copiar | `.input.mono` | `mono` + tnum, botão `headline` 600 |
| Input 6 dígitos | `.code-input` 1.4rem/0.5em | `code-mfa` 22.4px/600 mono (manter tracking) |
| Sidebar marca "Aurum Admin" | `.brand` 700 sem size | `brand` 16.8px/800 (+0.02em) |
| Links navegação | `.navlink` herda 15px | `headline` 15px/600 quando ativo, 400 quando inativo — **peso distingue estado, não só cor** (muda regra atual) |
| `h1` Painel/Financeiro | inline `margin:0`, size UA | `title-page` 20px/700 |
| Valor KPI dinheiro | `.kpi-value` 1.6rem/700 sans | `kpi-currency` mono + tnum |
| Valor KPI contagem | idem | `kpi-number` sans + tnum |
| Rótulo KPI + hint | `.kpi-label` 0.85rem / hint inline 0.85rem | `callout` (ambos) |
| Tabela `td` | `table.data` 0.92rem | `body` 15px/400 (0.92→15: simplifica, 0.92 era resquício) |
| Tabela `th` | 600 dim | `headline` 15px/600 dim (peso = hierarquia) |
| Badge status/role/fatura | `.badge` 0.78rem/600 | `micro` 12.5px/600 (+0.02em) |
| Tabs A pagar/A receber/… | `.tab` herda 15px | `headline`: ativa 600 + underline accent, inativa 400 dim |
| Filtros `label` Estado/Categoria | inline muted | `callout` 13.6px |
| Saldo do período, timezone | inline muted | `caption` 12.8px + tnum (saldo) / mono (hora) |
| `masked-json` rastro | sem fonte definida | `mono` 0.85em + tnum |
| Erros `.form-error` | `--danger` | texto `#ff9a9e` `body` 15px (contraste AA) |

Migração em 1 PR: trocar os ~12 `font-size` soltos de `globals.css` pelos tokens acima, adicionar `tnum` em `.kpi-value/td[data-numeric]/.mono`, trocar `navlink` inativo→400/ativo→600. Nada de componente novo.

# 01 — Cores · Aurum Bit Admin (Liquid Glass + HIG)

> Status: TRAVADO. Valores exatos. Não usar "pode ser", não improvisar hex no código.
> Stack: Next.js 14, CSS próprio, sem Tailwind. Temas via `[data-theme="light"|"dark"]` no `<html>`. Dark é default.
> Base herdada mantida: `bg #0F1115` + `dourado #E8B34B`.

---

## 1. Decisão sobre o dourado: SIM, manter — com correção de contraste

**Manter `#E8B34B` como acento de marca nos dois modos. Justificativa:**
1. Identidade Aurum Bit = ouro sobre grafite. Trocar por azul-sistema quebraria reconhecimento.
2. Em dark `#E8B34B` sobre `#0F1115` tem contraste ~7.2:1 — passa AA para texto e AAA para large.
3. Problema é só no light: `#E8B34B` sobre branco tem ~1.9:1 — REPROVA. Solução não é trocar o acento, é desdobrar em 3 tokens: `accent` (marca/decorativo), `accent-strong` (texto/ação com contraste) e `accent-soft` (fundo). Regra travada abaixo.

**Regra travada:**
- Nunca usar `#E8B34B` puro como cor de texto sobre fundo claro.
- Texto/ícone acionável em light usa `--accent-strong: #8A5E0E` (5.9:1 sobre branco, passa AA).
- Em dark, texto/ícone acionável usa `--accent: #E8B34B` (7.2:1 sobre `#0F1115`, passa AA).
- Fundo preenchido dourado (botão primário) usa `--accent` nos dois modos, com texto `--on-accent: #1A1405` (13.1:1, passa AAA).

---

## 2. Paleta completa

### 2.1 Dark (default, `[data-theme="dark"]`)

| Camada | Token | Valor | Uso |
|---|---|---|---|
| bg sunk | `--bg-0` | `#0B0D10` | body, área atrás da sidebar, overscroll |
| bg base | `--bg-1` | `#0F1115` | fundo padrão de página (herdado, inegociável) |
| bg elevado | `--bg-2` | `#171B22` | trilho de tabela, code block, skeleton |
| surface glass 1 | `--surface-1` | `rgba(23,27,34,0.60)` | card (com blur 20px — §4) |
| surface glass 2 | `--surface-2` | `rgba(27,32,41,0.70)` | modal/popover (com blur 30px) |
| surface glass 3 | `--surface-3` | `rgba(21,24,30,0.50)` | sidebar (com blur 24px + saturate) |
| surface sólida | `--surface-solid` | `#171B22` | fallback sem blur, dropdown denso, tabela |
| borda sutil | `--border-subtle` | `rgba(255,255,255,0.08)` | divisórias, card |
| borda média | `--border-medium` | `rgba(255,255,255,0.14)` | input idle, tabela |
| borda forte | `--border-strong` | `rgba(255,255,255,0.24)` | input hover/focus ring externo, handle |
| highlight especular | `--specular` | `inset 0 1px 0 rgba(255,255,255,0.10)` | borda-top interna de todo glass elevado (card/modal) |
| texto 1 | `--text-1` | `#F2EFE6` | títulos, valores — 15.4:1 sobre `--bg-1` |
| texto 2 | `--text-2` | `rgba(242,239,230,0.68)` ≈ `#A9ADB6` efetivo | labels, descrições — 7.0:1 |
| texto 3 | `--text-3` | `rgba(242,239,230,0.44)` ≈ `#74787F` efetivo | placeholder, caption, timestamp — 3.4:1 (NÃO usar p/ texto funcional, só decorativo) |
| acento | `--accent` | `#E8B34B` | links, ícones ativos, foco, botão primário (fundo) |
| acento hover | `--accent-hover` | `#F0C268` | hover do botão primário / link |
| acento pressed | `--accent-active` | `#C9962E` | pressed |
| acento suave | `--accent-soft` | `rgba(232,179,75,0.14)` | fundo de badge/selected row/kpi destaque |
| sobre-acento | `--on-accent` | `#1A1405` | texto sobre fundo `--accent` |
| perigo | `--danger` | `#F2555A` | erro, excluir (7.1:1 p/ texto sobre dark) |
| perigo suave | `--danger-soft` | `rgba(242,85,90,0.14)` | fundo badge erro |
| ok | `--success` | `#3EC97F` | (7.4:1) |
| ok suave | `--success-soft` | `rgba(62,201,127,0.14)` | |
| aviso | `--warning` | `#E8B34B` | = accent; em dark aviso e marca coincidem de propósito |
| aviso suave | `--warning-soft` | `rgba(232,179,75,0.14)` | |
| info | `--info` | `#5EB1EF` | (6.8:1) |
| info suave | `--info-soft` | `rgba(94,177,239,0.14)` | |
| foco | `--focus` | `#E8B34B` | ring `0 0 0 2px bg + 0 0 0 4px --focus` |

### 2.2 Light (`[data-theme="light"]`)

| Camada | Token | Valor | Uso |
|---|---|---|---|
| bg sunk | `--bg-0` | `#E7E9EE` | atrás de tudo, overscroll |
| bg base | `--bg-1` | `#F4F5F7` | fundo de página |
| bg elevado | `--bg-2` | `#FFFFFF` | trilho tabela, code |
| surface glass 1 | `--surface-1` | `rgba(255,255,255,0.62)` | card (blur 20px) |
| surface glass 2 | `--surface-2` | `rgba(255,255,255,0.72)` | modal (blur 30px) |
| surface glass 3 | `--surface-3` | `rgba(244,245,247,0.55)` | sidebar (blur 24px + saturate) |
| surface sólida | `--surface-solid` | `#FFFFFF` | fallback, dropdown, tabela |
| borda sutil | `--border-subtle` | `rgba(15,17,21,0.08)` | card, divisória |
| borda média | `--border-medium` | `rgba(15,17,21,0.16)` | input idle |
| borda forte | `--border-strong` | `rgba(15,17,21,0.32)` | hover/focus |
| highlight especular | `--specular` | `inset 0 1px 0 rgba(255,255,255,0.70)` | topo interno do glass |
| texto 1 | `--text-1` | `#14161A` | 15.2:1 sobre `#F4F5F7` |
| texto 2 | `--text-2` | `rgba(20,22,26,0.68)` ≈ `#5B5F66` | 7.0:1 |
| texto 3 | `--text-3` | `rgba(20,22,26,0.48)` ≈ `#85888F` | 3.6:1 (só decorativo) |
| acento marca | `--accent` | `#E8B34B` | SOMENTE decorativo em light (borda, gráfico, ícone large ≥24px). Proibido como texto. |
| acento ação | `--accent-strong` | `#8A5E0E` | texto, link, ícone funcional em light (5.9:1 sobre branco) |
| acento hover | `--accent-hover` | `#F0C268` | hover de fundo dourado (botão) |
| acento pressed | `--accent-active` | `#C9962E` | pressed |
| acento suave | `--accent-soft` | `rgba(138,94,14,0.12)` | fundo badge/selected em light |
| sobre-acento | `--on-accent` | `#1A1405` | texto sobre botão dourado (igual dark) |
| perigo | `--danger` | `#C92A30` | 6.2:1 sobre branco |
| perigo suave | `--danger-soft` | `rgba(201,42,48,0.10)` | |
| ok | `--success` | `#157F46` | 5.4:1 |
| ok suave | `--success-soft` | `rgba(21,127,70,0.10)` | |
| aviso | `--warning` | `#8A5E0E` | texto/aviso em light (= accent-strong) |
| aviso suave | `--warning-soft` | `rgba(138,94,14,0.12)` | |
| info | `--info` | `#0B6BCB` | 5.9:1 |
| info suave | `--info-soft` | `rgba(11,107,203,0.10)` | |
| foco | `--focus` | `#8A5E0E` | ring em light (dourado puro reprova como ring fino) |

---

## 3. Tokens semânticos — bloco CSS canônico (copiar e colar)

```css
:root, [data-theme="dark"] {
  color-scheme: dark;
  --bg-0: #0B0D10; --bg-1: #0F1115; --bg-2: #171B22;
  --surface-1: rgba(23,27,34,0.60);
  --surface-2: rgba(27,32,41,0.70);
  --surface-3: rgba(21,24,30,0.50);
  --surface-solid: #171B22;
  --border-subtle: rgba(255,255,255,0.08);
  --border-medium: rgba(255,255,255,0.14);
  --border-strong: rgba(255,255,255,0.24);
  --text-1: #F2EFE6; --text-2: rgba(242,239,230,0.68); --text-3: rgba(242,239,230,0.44);
  --accent: #E8B34B; --accent-hover: #F0C268; --accent-active: #C9962E;
  --accent-strong: #E8B34B; /* em dark, ação = marca */
  --accent-soft: rgba(232,179,75,0.14); --on-accent: #1A1405;
  --danger: #F2555A; --danger-soft: rgba(242,85,90,0.14);
  --success: #3EC97F; --success-soft: rgba(62,201,127,0.14);
  --warning: #E8B34B; --warning-soft: rgba(232,179,75,0.14);
  --info: #5EB1EF; --info-soft: rgba(94,177,239,0.14);
  --focus: #E8B34B;
}
[data-theme="light"] {
  color-scheme: light;
  --bg-0: #E7E9EE; --bg-1: #F4F5F7; --bg-2: #FFFFFF;
  --surface-1: rgba(255,255,255,0.62);
  --surface-2: rgba(255,255,255,0.72);
  --surface-3: rgba(244,245,247,0.55);
  --surface-solid: #FFFFFF;
  --border-subtle: rgba(15,17,21,0.08);
  --border-medium: rgba(15,17,21,0.16);
  --border-strong: rgba(15,17,21,0.32);
  --text-1: #14161A; --text-2: rgba(20,22,26,0.68); --text-3: rgba(20,22,26,0.48);
  --accent: #E8B34B; --accent-hover: #F0C268; --accent-active: #C9962E;
  --accent-strong: #8A5E0E;
  --accent-soft: rgba(138,94,14,0.12); --on-accent: #1A1405;
  --danger: #C92A30; --danger-soft: rgba(201,42,48,0.10);
  --success: #157F46; --success-soft: rgba(21,127,70,0.10);
  --warning: #8A5E0E; --warning-soft: rgba(138,94,14,0.12);
  --info: #0B6BCB; --info-soft: rgba(11,107,203,0.10);
  --focus: #8A5E0E;
}
```

Aliases legados (compat — usar os novos em código novo): `--surface-glass: var(--surface-1); --text-secondary: var(--text-2); --text-tertiary: var(--text-3);`

### Regras WCAG AA (travadas, valem p/ os dois modos)
1. Texto funcional (label, valor, link, botão, erro): usar SOMENTE `--text-1`, `--text-2`, `--accent-strong`, `--danger`, `--success`, `--info`, `--on-accent` sobre seu fundo. Todos ≥4.5:1. Exceção large (≥18.66px bold ou ≥24px): ≥3:1, aí `--warning` em dark liberado como texto large.
2. `--text-3` PROIBIDO para texto funcional. Permitido só p/ placeholder, caption, timestamp, ícone decorativo. Se o PO pedir "cinza claro legível", usar `--text-2`.
3. Badge/contador colorido: texto do badge usa a variante forte (`--danger`, `--success`, `--info`, `--accent-strong` em light / `--accent` em dark) sobre o `*-soft` correspondente — nunca texto branco sobre soft, nunca texto soft sobre branco.
4. Foco visível obrigatório: `:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 4px var(--focus); }`. Ring dourado puro só em dark; em light o ring é `--focus: #8A5E0E`.
5. Gráfico/delta positivo-negativo não pode depender só de cor: acompanhar de seta ▲▼ ou sinal +/−.

---

## 4. Translucidez + blur por elevação (Liquid Glass sem virar sabão)

Princípio HIG: blur transmite profundidade; conteúdo precisa continuar legível. Quanto maior a elevação, maior a opacidade E o blur (inverso do que iniciantes fazem).

| Nível | Componente | Fundo | Blur / filtro | Borda + luz |
|---|---|---|---|---|
| E0 página | body, tabela densa | `--bg-1` opaco, sem blur | `none` | — |
| E1 card | card, kpi, painel | `--surface-1` (60–62%) | `backdrop-filter: blur(20px) saturate(1.4); -webkit-...` | `1px solid var(--border-subtle)` + `box-shadow: var(--specular), 0 8px 24px rgba(0,0,0,0.25)` (dark) / `0 8px 24px rgba(15,17,21,0.08)` (light) |
| E2 flutuante | dropdown, tooltip, toast | `--surface-solid` OPACO | `none` (ver §5) | `1px solid var(--border-medium)` + sombra E1 |
| E3 modal | modal, sheet, command-K | `--surface-2` (70–72%) | `backdrop-filter: blur(30px) saturate(1.5)` + scrim `rgba(0,0,0,0.45)` (dark) / `rgba(15,17,21,0.30)` (light) atrás | `1px solid var(--border-medium)` + specular + `0 24px 64px rgba(0,0,0,0.45)` |
| E4 chrome | sidebar, topbar | `--surface-3` (50–55%) | `backdrop-filter: blur(24px) saturate(1.6)` | borda lateral `1px solid var(--border-subtle)`, sem sombra |

Notas de implementação (travadas):
- `backdrop-filter` SEMPRE acompanhado de `-webkit-backdrop-filter` (Safari) e de fallback opaco: `@supports not (backdrop-filter: blur(1px)) { .glass { background: var(--surface-solid); } }`.
- Máximo 3 superfícies com `backdrop-filter` visíveis ao mesmo tempo (sidebar + topbar + 1 card/modal). Dropdown sobre modal é opaco por isso.
- Saturate >1 é obrigatório quando houver blur (compensa o desbotamento); nunca usar `blur()` puro.
- Raio travado por nível: card 14px, modal 18px, sidebar/topbar 0, dropdown/tooltip 10px, badge/input 8px.

## 5. Quando NÃO usar blur (legibilidade + performance)
1. **Input/textarea/select (idle, focus, preenchido):** sempre `--surface-solid` opaco. Texto digitado sobre blur reprova legibilidade e quebra autofill do navegador.
2. **Tabela densa / linhas de dados / dropdown com >7 itens / tooltip pequeno:** opaco (`--surface-solid`). Blur em área com scroll de texto pequeno (<13px) gera franja e cansaço.
3. **Badge, chip, contador, toast de erro:** opaco (`--accent-soft`/`--danger-soft` são opacos o suficiente — são fundos sólidos translúcidos SEM blur). Blur atrás de texto de 11–12px destrói AA.
4. **Texto sobre glass:** só `--text-1`/`--text-2`. Se o fundo atrás do glass for foto/gráfico colorido, subir a opacidade do glass para 78% (`--surface-2`) em vez de aumentar o blur.
5. **Performance:** nunca animar `backdrop-filter`; animar `opacity/transform`. Em `prefers-reduced-motion: reduce` ou `prefers-reduced-transparency: reduce`, desligar blur globalmente (fallback sólido). Em lista virtualizada, células usam `--bg-2` opaco.

---

## 6. Tabela de decisão — qual token em cada componente

| Componente | Fundo | Borda | Texto | Acento/estado | Erro comum (não fazer) |
|---|---|---|---|---|---|
| Botão primário | `--accent` → hover `--accent-hover`, pressed `--accent-active` | nenhuma (ou `1px solid rgba(0,0,0,0.15)` em light p/ definição) | `--on-accent` 600 | foco: ring `--focus` | texto branco sobre dourado (reprova); dourado claro como texto em light |
| Botão secundário/ghost | transparente → hover `var(--border-subtle)` | `1px solid var(--border-medium)` | `--text-1` | hover borda `--border-strong` | ghost sem borda sobre glass (some no fundo) |
| Botão perigo | `--danger` (sólido) | nenhuma | `#FFFFFF` em light / `#1A0505`? TRAVADO: `#FFFFFF` nos dois (5.9:1/4.6:1) | fundo soft `--danger-soft` só p/ variante "sutil" com texto `--danger` | usar warning dourado p/ excluir |
| Input / select | `--surface-solid` | `--border-medium`, hover `--border-strong`, focus `1.5px solid var(--accent-strong)` + ring | valor `--text-1`, placeholder `--text-3`, label `--text-2` | erro: borda `--danger` + msg `--danger` 12px | input com blur; placeholder em `--text-2` (vira "valor falso") |
| Card / KPI | `--surface-1` + blur 20px | `--border-subtle` + `--specular` | título `--text-1`, meta `--text-2`, caption `--text-3` | destaque: faixa lateral 3px `--accent` ou fundo `--accent-soft` | card opaco + sombra gigante (vira "material", não glass) |
| Modal / sheet | `--surface-2` + blur 30px + scrim | `--border-medium` + specular | título `--text-1` 17px/600, corpo `--text-2` | primário no footer à direita (HIG) | modal sem scrim; dropdown interno com blur |
| Sidebar / topbar | `--surface-3` + blur 24px saturate 1.6 | divisória `--border-subtle` | item `--text-2`, ativo `--text-1` + fundo `--accent-soft` + indicador 3px `--accent(-strong)` | seção `--text-3` 11px uppercase 0.08em | item ativo só com cor, sem fundo/indicador (some p/ daltônico) |
| Badge / chip | `*-soft` opaco (`--accent-soft`, `--success-soft`...) | `1px solid` da cor forte a 30% | cor forte (`--accent-strong`, `--success`...) 12px/600 | neutro: `--border-medium` + `--text-2` | texto 11px com blur atrás; cinza `--text-3` como badge |
| Tabela | header `--bg-2` opaco, linhas alternadas `rgba` 3% | linha `var(--border-subtle)` | célula `--text-1`, secundário `--text-2`, header `--text-2` 12px uppercase | row selected: `--accent-soft` + borda-l `--accent` | tabela inteira em glass com blur; zebra forte (polui dado financeiro) |

Regra de ouro (desempate): **dúvida entre dois tokens → escolher o de maior contraste.** Glass é efeito, legibilidade é requisito.

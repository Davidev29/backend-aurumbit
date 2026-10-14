# 06 — Componentes · Aurum Bit Admin (Liquid Glass + HIG)

> Status: TRAVADO. Valores exatos. Herda de `01-cores.md` (tokens `surface`, `accent`, `danger/ok/warn`), `02-tipografia.md` (escala e pesos), `04-motion.md` (`DUR`, `EASE_OUT`, `reducedMotion="user"`), `05-sidebar.md` (chrome E4, drawer `320px`). Stack: Next.js 14 App Router + Tailwind (arbitrary values colados nos tokens) + recharts só no financeiro. Apple HIG: alvos 44pt, foco sempre visível, conteúdo opaco, chrome translúcido. Nenhum asset copiado — todo CSS é próprio (`app/globals.css` + classes deste doc).

---

## 0. Inventário real (o que existe hoje — auditado arquivo a arquivo)

| Padrão | Onde vive | Estado real |
|---|---|---|
| Botão | `globals.css` `.btn`, `.btn-primary`, `.btn-danger`, `.btn-icon`, `.btn-lg` + usos em todas as páginas | Existe. Sem variante `ghost`/`secondary` nomeada (secundário = `.btn` puro) |
| Input / select / textarea | `.input`, `.select`, `.input-lg`, `.code-input`, `.password-wrap` + `.password-toggle` | Existe. `textarea` reusa `.input` com `rows={3}`. Sem `switch`, sem `checkbox` estilizado (nativo) |
| Tabela | `components/ui/table.tsx` (`Table/THead/TBody/TR/TH/TD`) + `.table-wrap` + `table.data` | Existe. Semântica `thead/tbody/scope` travada |
| Paginação | Inline em `cobrancas`, `auditoria`, `assinaturas`, `financeiro` (`Pager`/`history: Array<string\|null>`) | Existe como **padrão cursor Anterior/Próxima**. Sem componente dedicado, sem páginas numeradas |
| Badge | `.badge` + `.badge-owner/admin/finance/grace/invoice-paid/overdue/refunded/pending` + `RoleBadge`, `InvoiceBadge`, `FinanceBadge`, `GraceBadge`, `TimezoneBadge` | Existe. Sistema mais maduro do admin |
| Card / KPI | `.card`, `.card-grid`, `.kpi-label/.kpi-value` + `KpiCard` | Existe |
| Modal / dialog | `components/licencas/Modal.tsx` + `.dialog-overlay/.dialog/.dialog-actions` | Existe. Tamanho único. Usado por Revoke/Renew/AdjustMachines/Bonus/Refund/CancelSubscription/Settle/Replay + `TraceabilityDrawer` (nome engana: é Modal) + `SearchCmdk` (overlay próprio) |
| Drawer lateral | `.drawer-overlay/.drawer` + `MobileDrawer` | Existe, **uso único: navegação mobile**. Nenhum drawer de conteúdo |
| Dropdown / menu | `.menu` + `AccountMenu`, `OrgSwitcher`, `NotificationsBell` | Existe como popover absoluto. Sem biblioteca |
| Toast / snackbar | — | **NÃO EXISTE.** Sucesso = `.card[role=status]` inline (filas replay); erro = `.form-error[role=alert]` inline |
| Tooltip | `title=` nativo + `Tooltip` do recharts (só `ProjectionChart`) + `TOOLTIP` de reveal | **NÃO EXISTE componente.** Só `title` nativo |
| Tabs | `.tabs/.tab[aria-selected]` (financeiro 4 tabs, cliente `[id]` 4 tabs) + `.segmented` (PeriodFilter `aria-pressed`) | Existem dois sabores (tabs sublinhadas + segmented) |
| Skeleton | `components/ui/skeleton.tsx` + `.skeleton` shimmer | Existe (`Skeleton`, `SkeletonTable`, inline `height: 12rem/18rem/8rem`) |
| Empty-state | `EmptyState` + `.feedback` | Existe, com `action` (padrão "Limpar filtros") |
| Erro / stale | `ErrorState[role=alert]` + `StaleBanner[role=status]` (+ `StaleState` deprecated = alias) + `ForbiddenState` | Existe. `StaleBanner` só em snapshots (financeiro/filas), nunca em listas vivas |
| Filtros | `FilterBar` (financeiro), forms inline (cobranças/auditoria), busca com debounce 300ms (clientes), facets (projeção) | Existe como padrão, sem componente dedicado |
| Formulários destrutivos | `RevokeDialog`, `RenewDialog`, `AdjustMachinesDialog`, `BonusDialog`, `RefundDialog`, `CancelSubscriptionDialog`, `SettleDialog`, `ReplayDialog` (filas) | Existe e é **o padrão mais consistente do admin**: motivo ≥10 + checkbox + `pending` |
| Export 2-passos inline | `ExportButton` (finance), `BillingExportButton` | Existe (checkbox inline, sem modal) |
| Especiais | `LicenseKeyMasked` (reveal auditado), `HeartbeatDot` (3 estados), `MaskedJson` (defesa em profundidade), `ProjectionChart` (gráfico + tabela alternativa), `TraceabilityDrawer` (timeline em 5 passos), `SearchCmdk` (Cmd+K stub), `TimezoneBadge` | Existem |
| Carrossel / slider | — | **NÃO EXISTE.** Zero ocorrências (`carousel/slider` = 0 hits) |
| Switch | — | **NÃO EXISTE** (só `checkbox` nativo) |
| Janelas (multi-window) | — | **NÃO EXISTE** (só `details/summary` como disclosure: `manual-key`, tabela alternativa do gráfico) |

---

## 1. Núcleo: botões, inputs, tabelas, paginação

### 1.1 Botão — anatomia travada

```css
.btn { border: 1px solid var(--border); background: var(--bg-softer); color: var(--text);
  border-radius: 8px; padding: 0.5rem 0.9rem; font: inherit; cursor: pointer; min-height: 36px; }
.btn:hover { border-color: var(--text-dim); }
.btn:active { transform: translateY(1px); }            /* HIG: confirmação física, 1px só */
.btn:disabled { opacity: 0.45; cursor: not-allowed; }  /* WCAG AA: opacidade, nunca só cor */
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } /* global, nunca remover */
```

| Variante | Token travado | Uso |
|---|---|---|
| Secundária (`.btn` puro) | `bg-softer/border/text` | Ação padrão: Voltar, Cancelar, Fechar, Ver, filtros "Limpar" |
| Primária (`.btn-primary`) | `bg/border: var(--accent); color: var(--accent-ink); font-weight: 600` | Ação principal não-destrutiva: Entrar, Conceder bônus, Confirmar replay, `Pagar/Baixar` (Settle) |
| Destrutiva (`.btn-danger`) | `border: var(--danger); color: #ff9a9e` + hover `border: #ff9a9e` | Revogar, Estornar, Cancelar assinatura. **Sempre com confirmação 2-passos (§4)** |
| Ghost (NOVO — normalizar) | `border: transparent; background: transparent; color: var(--text-dim)` + hover `bg-softer/text` | Fechar `✕`, toggle senha, ações terciárias em tabelas. Hoje esses usos improvisam `.btn.btn-icon` ou `.password-toggle` — migrar p/ `.btn-ghost` |
| Ícone (`.btn-icon`) | `padding: 0.5rem; line-height: 1` sobre a variante base | `☰ ✕ 🔔 Revelar/Ocultar`. Alvo HIG: garantir `min-width/height: 44px` via padding (hoje ~36px — **elevar p/ 44px no DS**) |
| Grande (`.btn-lg` + `.input-lg`) | `padding: 0.7rem 0.9rem; font-size: 1rem` | **Só auth** (login/MFA). Proibido no app interno |

Estados obrigatórios: `default → hover (borda) → active (translateY 1px) → focus-visible (anel accent 2px) → disabled (0.45 + not-allowed + `title` explicando o porquê) → loading (label com reticência `…`: `Estornando…/Revogando…/Entrando…`, botão travado com `disabled={pending}`)`.
Regra dura: **todo `disabled` em ação com permissão carrega `title` com o motivo** — padrão já real (`Requer permissão billing.manage`, `Só faturas pagas podem ser estornadas`, `Fila vazia — nada a re-enfileirar`). Erro de permissão nunca é mudo.
Anti-padrões: ❌ destrutiva sem checkbox+motivo; ❌ `disabled` sem `title`; ❌ dois primários no mesmo footer; ❌ spinner substituindo o label (manter label + `…`); ❌ botão-link (`<Link class="btn">` só p/ navegação real: "Abrir cobranças" — nunca p/ ação).

### 1.2 Input / select / textarea / checkbox / search / date

```css
.input,.select { font: inherit; color: var(--text); background: var(--bg-softer);
  border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.75rem; width: 100%; min-height: 40px; }
.input::placeholder { color: var(--text-dim); }
.input:focus,.select:focus,textarea.input:focus { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: 1px; }
.form-error { color: var(--danger); margin: 0 0 0.9rem; } /* sempre com role="alert" */
.field { margin-bottom: 0.9rem; } .field>label { display:block; margin-bottom: 0.3rem; font-weight: 600; }
.code-input { text-align:center; font-size:1.4rem; letter-spacing:0.5em; text-indent:0.5em; } /* MFA, 6 dígitos */
```

Ordem canônica travada: **`label → input → hint (`.muted`) → erro (`.form-error[role=alert]`)**. Erro aparece sob o campo, nunca só no topo; em dialogs destrutivos o erro de submit vai acima de `.dialog-actions` (§4).
Tipos reais e regras: `email` (`autoComplete=username`), `password` com `.password-wrap` (input `padding-right: 3.2rem` + `.password-toggle` ghost à direita, `aria-label` alternando Mostrar/Ocultar), `search` (clientes/auditoria), `date` (filtros vencimento/período — valor ISO convertido `T00:00:00.000Z/T23:59:59.999Z` no submit), `textarea.input[rows=3]` (todos os motivos), `checkbox` nativo (confirmações + `ExportButton` + `BonusDialog` vitalício). `select.select` para estados/categorias/produtos com primeira option `Todos/Todas`.
`Switch`: não existe e **não criar** — HIG prefere clareza admin: confirmações destrutivas ficam em `checkbox` explícito com texto ("Confirmo… e entendo que é auditado"). Se um dia precisar de on/off persistente, usar `.segmented` (já existe), nunca toggle animado.
Anti-padrões: ❌ placeholder como label; ❌ erro só por cor (sempre texto + `role=alert`); ❌ `autoFocus` fora de modal (dentro de modal: **1 por dialog, no primeiro campo** — padrão real); ❌ máscara que impede colar (MFA aceita colar e filtra `\D`).

### 1.3 Tabela — anatomia travada

Estrutura (`components/ui/table.tsx`, manter API p/ futura adoção shadcn auditada):

```tsx
<div className="table-wrap"><table className="data">
  {caption && <caption className="muted">{caption}</caption>}{children}
</table></div>
```

```css
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
table.data { width:100%; border-collapse: collapse; font-size: 0.92rem; }
table.data th,table.data td { text-align:left; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border); }
table.data thead th { background: var(--bg-softer); color: var(--text-dim); font-weight: 600; }
```

Colunas por domínio (travar cabeçalhos): licenças `Chave·Status·Validade·Máquinas·Origem·Ações`; cobranças `Fatura·Cliente·Valor·Vencimento·Estado·Detalhe`; auditoria `Ocorrido em·Ator·Ação·Recurso·CorrelationId·Detalhe`; filas `Fila·Profundidade·Mais antiga·Último erro·Ações`. Valores monetários com `formatBRL`, datas com `formatDate(In)TZ` (America/Sao_Paulo), IDs com `.mono`. Célula `Máquinas` usa `title=` com expansão (`3 de 5 máquinas em uso`). Tabela vazia **nunca renderiza armadura vazia**: retorna `<EmptyState>` (padrão `LicenseTable`).
Regras: scroll horizontal no wrapper (nunca na página); `caption.muted` sempre (acessibilidade + contexto); última linha sem borda dupla (manter `border-bottom` simples — não arredondar células). Números alinhados à esquerda (padrão atual — manter; não centralizar).
Anti-padrões: ❌ ação destrutiva direto na linha (linha só abre detalhe/dialog); ❌ truncar ID sem `title`/link; ❌ badge sem `aria-label="Estado: X"`.

### 1.4 Paginação cursor — anatomia travada (NÃO criar páginas numeradas)

Padrão real unificado (extrair p/ componente `Pager` — hoje duplicado em 4 páginas + `Pager` local no financeiro):

```tsx
const [history,setHistory]=useState<Array<string|null>>([null]);
const [pageIdx,setPageIdx]=useState(0); const cursor=history[pageIdx]??null;
// resetPaging() em TODA mudança de filtro. next: history.slice(0,pageIdx+1)+nextCursor.
<div style={{display:"flex",gap:"0.5rem",marginTop:"0.75rem"}}>
  <button className="btn" disabled={pageIdx===0}>← Anterior</button>
  <button className="btn" disabled={!page.meta.nextCursor}>Próxima →</button>
</div>
```

`Table caption` declara o modelo: `"Faturas (paginação por cursor)"`. `Pager` retorna `null` se `!page || data.length===0`. Filtros sempre disparam `resetPaging`/`pg.reset` (bug clássico que o padrão atual já previne).
Anti-padrões: ❌ numeração `1·2·3` (cursor do backend não suporta salto); ❌ manter cursor antigo após trocar filtro; ❌ esconder `Anterior` na primeira página (manter desabilitado — estabilidade de layout).

---

## 2. Badges, cards/KPI, dots, feedback

### 2.1 Badge — anatomia travada

```css
.badge { display:inline-block; padding:0.15rem 0.55rem; border-radius:999px;
  font-size:0.78rem; font-weight:600; border:1px solid var(--border); background:var(--bg-softer); color:var(--text); }
```

Mapa de cor travado (borda+texto, fundo sempre `bg-softer` — nunca pastilha sólida): `owner accent / admin #8ec5ff / finance #d3a0fa / grace+pending warn / invoice-paid+Pg/Recebido/Receita ok→#7dd68f / invoice-overdue+Vencido+Despesa danger→#ff9a9e / invoice-refunded+Cancelado #d3a0fa / neutro (Member/Cancelled-fatura) base`. Todo badge de estado carrega `aria-label="Estado: X"` com label pt-BR (`Pendente/Paga/Vencida/Estornada/Cancelada`, `Previsto/Pendente/Recebido/Pago/Vencido/Cancelado`, `Ativa/Graça (degradado)/Suspensa/Expirada/Revogada`).
Casos especiais: `GraceBadge` (graça degradada + `title` explicando `X-Aurum-Grace` + linha mono do header abaixo), `TimezoneBadge` (`America/Sao_Paulo · HH:MM`, tick 30s, `title` com fuso — presença obrigatória em financeiro/filas/projeção), `HeartbeatDot` (dot `.55rem` + label: `online dot-live ok <2min / idle dot-idle warn <15min / offline cinza`, `title` com absoluto+relativo, `time[dateTime]`), `RoleBadge` (papel em caixa alta), `.mono` p/ IDs (`corr-…`, `inv-…`).
Anti-padrões: ❌ cor como único sinal (sempre texto); ❌ badge clicável (se filtra, usar botão); ❌ novo matiz fora do mapa (reusar os 6).

### 2.2 Card / KPI — anatomia travada

```css
.card { background:var(--bg-soft); border:1px solid var(--border); border-radius:var(--radius); padding:1rem 1.25rem; }
.card-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:1rem; }
.kpi-label { color:var(--text-dim); font-size:0.85rem; margin:0; }
.kpi-value { font-size:1.6rem; font-weight:700; margin:0.25rem 0; }
```

`KpiCard{label,value,kind:"currency"|"number",hint}`: `currency` via `formatBRL`, número via `toLocaleString("pt-BR")`, `hint.muted 0.85rem` (contexto: `Stub Fase 2`, `% do total a receber`, `Snapshot de …`). Grid do dashboard: 4 KPIs; financeiro: Previsto/Pendente/Realizado/Inadimplência. Sucesso inline (filas replay) = `.card[role=status]` com `borderColor: var(--ok)` — **este é o "toast" do admin**: inline, persistente, com `auditId` clicável. Liquid Glass: cards são **opacos** (`bg-soft` sólido, sem blur) — blur é privilégio do chrome (sidebar/topbar/dialog), nunca de superfície de dados.
Anti-padrões: ❌ KPI sem hint quando o dado é stub/snapshot; ❌ grid com menos de `220px` por coluna; ❌ sombra externa em card (sombra só no `auth-card`: `0 12px 40px rgba(0,0,0,.45)`).

### 2.3 Skeleton / Empty / Erro / Stale / Forbidden

- **Skeleton**: `.skeleton` (shimmer `90deg bg-softer→border`, `200%`, `1.2s infinite`, `radius 6px`, `min-height 1rem`) + `role="status" aria-label="Carregando…"`; tabelas usam `SkeletonTable{rows:5}` (`2.2rem`/linha) ou bloco `height: 12rem` (listas) / `18rem` (gráfico) / `8rem` (detalhe/rastro); contêiner com `aria-busy`. `prefers-reduced-motion: reduce` desliga shimmer (já real). QR do MFA usa skeleton `200×200` como placeholder.
- **Empty** (`.feedback`: center, `3rem 1rem`, texto `text-dim`, `h2` em `text`): `title` (sem jargão: "Nenhuma cobrança encontrada") + `message` (próximo passo: "Ajuste os filtros…") + `action.btn` ("Limpar filtros" que reseta filtros+paging — padrão cobranças/auditoria/projeção; filas usa "Atualizar").
- **Erro**: `ErrorState[role=alert]` ("Ocorreu um erro" + mensagem + `Tentar novamente.btn` com `nonce++`). Detalhe/rastro com erro vira `.card` com `ErrorState + Fechar`.
- **Stale**: `StaleBanner[role=status]` = `.card` com `borderColor: warn` + "Dados possivelmente desatualizados." + `staleReason` + `Snapshot de {asOf} (America/Sao_Paulo)` + `Atualizar.btn`. **Só em snapshots** (resumo/projeção/filas). Listas vivas (cobranças/assinaturas/auditoria) nunca exibem.
- **Forbidden**: `ForbiddenState[role=alert]` ("Acesso negado (403)" + permissão exigida em `.mono` + "Voltar ao painel"). Gate duplo travado: middleware (redirect) + `<RequirePerm perm organizationId?>` (Forbidden inline).
Anti-padrões: ❌ toast flutuante p/ erro crítico (admin exige erro ancorado + retry); ❌ empty sem ação; ❌ skeleton sem `aria-label`.

### 2.4 Tabs, segmented, menu/dropdown, search, drawer, tooltip, chart

- **Tabs** (`.tabs/.tab`, `role=tablist/tab/tabpanel`, `aria-selected`): `padding 0.6rem 0.9rem`, `border-bottom 2px transparent`, ativa com `border-bottom-color: accent` + `color: text`. Usos: financeiro (A pagar/A receber/Transações/Projeções), cliente `[id]` (Perfil/Contratos/Licenças/Sessões). Alvo HIG 44px via padding vertical.
- **Segmented** (`.segmented`, `role=group`, `aria-pressed`): `PeriodFilter` Semana/Mês/Ano + projeção Semanal/Mensal/Anual. Botão `0.45rem 0.9rem`, ativo `bg-softer + 600`.
- **Menu** (`.menu`: absolute `right:0; top:calc(100%+6px)`, `min-width 14rem`, `bg-soft` **opaco**, `radius`, `padding .5rem`, `z-30`): itens `block w-full padding .5rem .6rem radius 6px`, hover `bg-softer`. Disparadores com `aria-haspopup + aria-expanded` (`menu/listbox/dialog` conforme o caso). Usos: `AccountMenu` (nome+email+sair), `OrgSwitcher` (`listbox/option/aria-selected + ✓`), `NotificationsBell` (stub com `.muted`).
- **Command-K** (`SearchCmdk`): trigger `.btn` ("Buscar… `Ctrl+K` mono") + `dialog-overlay/dialog` com `input` autofocado, `Ctrl/⌘+K` alterna, `Escape` fecha. Escopo travado: stub até busca real com debounce+permissões.
- **Drawer**: `.drawer-overlay` (`fixed inset-0 rgba(0,0,0,.6) z-40`) + `.drawer` (`fixed left/top/bottom, min(20rem,85vw), bg-soft, border-right, z-41, padding .75rem`). **Uso único: `MobileDrawer`** (navegação `<1024px`, `role=dialog aria-modal`, fecha no overlay e no `✕`). `TraceabilityDrawer` é Modal, não drawer — renomear p/ `TraceabilityDialog` no DS (mantém alias).
- **Tooltip**: sem componente; travado como `title=` curto + `aria-label` onde há ícone (`Revelar chave (auditado)`, disabled-reasons, `Máquinas`, `TimezoneBadge`). Gráfico usa `Tooltip` do recharts com `contentStyle bg-softer/border/radius 8` + `Legend` pt-BR. **Não criar lib de tooltip** (P2 no máximo).
- **Chart** (`ProjectionChart`): `ComposedChart` (Bar receita `#46a758` + despesa `#e5484d` `radius [4,4,0,0]` + Line tendência accent) em `.card[role=img]` com `aria-label` que narra todos os buckets + `<details>` "Ver dados em tabela" (WCAG: gráfico nunca é o único meio). Grid `#2a2f3a`, eixo `tick 12px #a7adbb`, Y `R$Xk`. Filtros período+categoria+produto (facets) + `TimezoneBadge` à direita.

---

## 3. Modais — padronização travada (sm/md/lg, header/body/footer, foco, Escape, backdrop)

Estado real: `Modal.tsx` tem **tamanho único** (`min(36rem,92vw)`) e estrutura mínima (`h2 + children`). Padronizar sem quebrar os 8 dialogs existentes:

```css
.dialog-overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:50;
  display:flex; align-items:flex-start; justify-content:center; padding:15vh 1rem 1rem; }
.dialog { width:min(36rem,92vw); background:var(--bg-soft); border:1px solid var(--border);
  border-radius:var(--radius); padding:1rem; }              /* md = padrão atual */
.dialog[data-size="sm"] { width:min(24rem,92vw); }          /* confirmações curtas */
.dialog[data-size="lg"] { width:min(48rem,94vw); }          /* rastro/auditoria */
```

Anatomia canônica (todos os dialogs migram p/ ela):

```tsx
<Modal titleId="x-title" title="Verbo + objeto" size="md" onClose={onClose} initialFocus="first-field">
  <p className="muted">Contexto: <code className="mono">{id}</code> + consequência irreversível/auditada.</p>
  <form onSubmit={handleSubmit}>
    <div className="field">…label→input→hint→erro…</div>
    <p className="form-error" role="alert">…erro de submit…</p>
    <div className="dialog-actions">…Voltar/Cancelar .btn + ação .btn-danger/.btn-primary…</div>
  </form>
</Modal>
```

Travas: `role=dialog aria-modal=true aria-labelledby=titleId`; **header** = `h2[margin-top:0]` (título = verbo+objeto: "Revogar licença", "Estornar fatura", "Replay DLQ — {fila}"); **body** = contexto `.muted` + form; **footer** = `.dialog-actions` (`flex gap .5rem justify-end margin-top 1rem`); foco inicial no primeiro campo (`autoFocus`, 1 por dialog); `Escape` fecha (`keydown` listener com cleanup); clique no overlay fecha **só** se `e.target===e.currentTarget` + `onMouseDown` (não `onClick` — evita fechar ao arrastar seleção); backdrop `rgba(0,0,0,.6)` único (sem blur — dialog é opaco; blur simultâneo estoura o orçamento de 3); `pending` trava tudo (`disabled={pending}` no Voltar + ação com label `…`); erro de submit em `.form-error[role=alert]` acima do footer.
Tamanhos: `sm` confirmações curtas (reveal? export se virar modal); `md` (padrão) todos os destrutivos atuais; `lg` rastro em 5 passos + detalhe de fatura/auditoria quando elevados a modal. `SearchCmdk` usa `md` sem footer. Liquid Glass: dialog pode ganhar `inset 0 1px 0 rgba(255,255,255,.08)` (specular de topo, como chrome E4) — nunca `backdrop-filter` no dialog.
Anti-padrões: ❌ modal dentro de modal (rastro abre **no lugar** do detalhe, nunca empilhado — ver auditoria `ExpandedEvent`); ❌ fechar no overlay durante `pending`; ❌ título genérico ("Confirmar", "Atenção"); ❌ footer com 3+ botões.

---

## 4. Formulários — padronização travada (1-col, ordem, validação, submit, 2-passos)

**Layout 1-col** em tudo (auth `max-width 400px`, dialogs `md 36rem`): `.field` empilhados, nunca 2-col (exceção: `key-row` MFA input+Copiar e linhas de filtro — filtros não são formulários de escrita). Ordem por campo: `label[for]` → `input/select/textarea` → `hint.muted` → `erro`. `label` sempre visível (`font-weight 600`, `margin-bottom .3rem`); `muted` pequeno só p/ labels de filtro.

**Validação inline**: motivo `trim().length>=10` (licenças/billing/filas/finance — mesma constante, mesma mensagem "mín. 10 caracteres, auditado"); `BonusDialog` soma `endsAt` válido ou `lifetime`; MFA filtra não-dígitos, auto-submit aos 6; submit travado por `valid = motivo&&confirmado` (`disabled={!valid||pending}`). Erro de campo sob o campo; erro de rede como `.form-error[role=alert]` acima das ações. Nunca limpar o motivo digitado após erro de rede.

**Botão submit**: primário p/ escrita reversível (`Conceder bônus`, `Confirmar replay`, `Pagar/Baixar`), **destrutivo p/ irreversível** (`Revogar licença`, `Estornar fatura`, `Cancelar assinatura`); label carrega objeto ("Estornar fatura", não "Confirmar"); loading = verbo+`…` (`Revogando…/Estornando…/Re-enfileirando…`); secundário = `Voltar` (destrutivos billing/filas/finance) ou `Cancelar` (licenças) — unificar p/ **"Voltar" em destrutivo auditado, "Cancelar" em criação** no DS.

**Confirmação destrutiva em 2 passos** (padrão-ouro do admin, replicar em todo novo mutador):
1. `textarea` motivo (`rows=3`, `autoFocus`) + 2. `checkbox` "Confirmo … e entendo que é auditado" + submit `disabled` até ambos. `RequirePerm` envolve o form (permissão real no backend; botão de abertura já vem `disabled+title` sem ela). Contexto `.muted` no topo cita consequência ("bump `token_version`… Irreversível por esta tela", "será marcada como `REFUNDED`", "`queue.replay`"). Export segue a mesma lógica **inline** (2 estados: `Exportar CSV → checkbox+Confirmar exportação/Cancelar`), sem modal.
Formulários por domínio (todos já seguem o molde — travar): licenças `Revoke/Renew/AdjustMachines` (`license.adjust`) + `Bonus` (`bonus.grant`, sem checkbox — motivo+data bastam por ser reversível); billing `Refund` (`billing.manage`, só `PAID`) + `CancelSubscription` (`billing.manage`); financeiro `Settle pay/receive` (`finance.manage`, gera `Transaction`); filas `Replay` (`billing.manage`, `depth===0` desabilita abertura); auth login (email+senha+toggle, `btn-primary btn-lg w-full`) e MFA (QR `200px` em `.qr-frame` branco + `details.manual-key` + `code-input` + `btn-lg`).
Anti-padrões: ❌ `confirm()` nativo; ❌ motivo opcional em ação auditada; ❌ checkbox pré-marcado; ❌ submit fora do `form onSubmit` (Enter deve funcionar); ❌ duplicar `titleId` entre dialogs abertos.

---

## 5. Carrosséis custom + janelas — 2 usos concretos (nada existe hoje; propor só onde o admin ganha)

Princípio HIG: carrossel no admin é **navegação entre irmãos**, nunca vitrine. Só propor com setas 44px + dots + teclado (`←/→`) + `prefers-reduced-motion` (vira lista) + alternativa em tabela. Vidro: setas = chrome E4 (blur 24px), slides = opacos.

### Uso 1 — Carrossel "Planos da assinatura" (assinaturas → detalhe; resolve tabela plana `ACTIVE/PAST_DUE/TRIAL/CANCELLED`)

Hoje assinaturas é tabela + `CancelSubscriptionDialog`. Quando o detalhe ganhar histórico de planos (trial→ativo→past_due→cancelada), os irmãos cabem num carrossel horizontal dentro do `lg` dialog/detalhe:
Anatomia travada: viewport `overflow-x:auto; scroll-snap-type:x mandatory; gap .75rem; padding .25rem` + slides `.card` `min-width:min(20rem,80vw)` `scroll-snap-align:start` (cada slide = `badge` estado + `MRR formatBRL` + `nextDue formatDateInTZ` + ação) + setas `.btn-icon.btn-ghost` 44px glass flutuantes (`position:sticky`, nunca sobre texto) + dots (`8px`, ativo `accent 24px` pill) + `aria-roledescription=carousel`, `aria-live=polite` no slide ativo + teclado `←/→` + fallback `details>table` com os mesmos planos. Começa no plano atual, swipe nativo no mobile, sem autoplay (admin nunca autoplay).
Anti-padrão: ❌ carrossel p/ escolher plano no cancelamento (cancelar é form, não vitrine).

### Uso 2 — Janela "Rastro" como janela ancórivel (auditoria/financeiro; eleva `TraceabilityDrawer` + `ExpandedEvent`)

Hoje o rastro é Modal centrado em 5 passos (`Charge→Fatura→Financeiro→Transação→Auditoria`) que bloqueia a tabela. Propor **janela lateral ancórivel** (same pattern do `MobileDrawer`, lado direito) p/ comparar evento × rastro:
Anatomia travada: `.window` `fixed right:1rem; top:calc(56px + 1rem); bottom:1rem; width:min(28rem,92vw); z-45` (abaixo do modal `z-50`, acima do conteúdo), `bg-soft` opaco + `radius` + `border` + header fixo (`Rastro {id}` + `correlationId.mono` + `✕` 44px) + body scroll (`ol.trace-steps gap .75rem`, cada passo `strong` + `.muted`/badges + links `Ver`) + footer (`Abrir cobranças/assinaturas` + `Fechar`); abre com `slideOver 240ms ease.out` (mesmo do drawer, `04`), fecha com `Escape`/overlay leve/só-`✕` (sem backdrop pesado — janela é não-modal: tabela continua clicável); `role=complementary aria-label="Rastro {id}"` (não `dialog` — não rouba foco; foco vai p/ o `✕` só se aberto por teclado); em `<1024px` vira Modal `lg` full (sem janela flutuante no mobile). Segundo uso da mesma janela: **sessões da licença** (`SessionTable` + `HeartbeatDot` por sessão) ancórivel do detalhe do cliente — mesma anatomia, outro conteúdo.
Anti-padrão: ❌ duas janelas simultâneas (abrir uma fecha a outra); ❌ janela p/ form destrutivo (form é sempre Modal centrado §3).

---

## 6. Lista priorizada (critério: frequência × risco × dispersão atual)

Critério: P0 = usado em quase toda tela E com divergência real hoje (risco de inconsistência/a11y); P1 = padrão crítico mas já consistente (extrair e travar); P2 = inexistente ou raro (criar só sob demanda, sem pressa).

| Prioridade | O que construir | Por quê (evidência) |
|---|---|---|
| **P0** | `Button` (inclui `ghost` 44px + `title`-em-disabled obrigatório) | 5 sabores improvisados; `btn-icon` abaixo de 44px HIG; regra do `title` existe mas não é componente |
| **P0** | `Dialog` (sm/md/lg + header/body/footer + `initialFocus` + trava de `pending`) | 8 dialogs copiam o mesmo molde à mão; `TraceabilityDrawer` mente no nome; sem tamanhos |
| **P0** | `DestructiveForm` (motivo≥10 + checkbox + erro + footer Voltar/ação) | Oito implementações idênticas de `valid/pending/error`; unificar elimina deriva futura |
| **P0** | `Field` (label→input→hint→erro + `form-error[role=alert]`) | Ordem existe mas montada à mão em cada dialog; auth e filtros divergem nos detalhes |
| **P0** | `Table` + `Pager` (caption obrigatória + cursor Anterior/Próxima) | `Pager` duplicado em 4 arquivos; caption varia; regra `resetPaging` precisa vir no componente |
| **P1** | `Badge` (mapa de 6 cores + `aria-label Estado`) + `Dot` (heartbeat 3 estados) + `TimezoneBadge` | Já consistente — extrair p/ impedir deriva, sem mudar visual |
| **P1** | `KpiCard` + `card-grid` + `.card[role=status]` (o "toast" inline) | Travar "sem toast flutuante" como decisão + documentar sucesso inline com `auditId` |
| **P1** | `Tabs` + `Segmented` + `Menu` (opaco, `aria-expanded`) + `FilterBar` (flex-wrap + limpar-reseta-paging + debounce 300ms busca) | Três padrões sólidos mas copiados; `FilterBar` vira componente com `exportScope` |
| **P1** | `Empty/ Error/Stale/Forbidden` + `Skeleton(Table)` + `MaskedJson` + `LicenseKeyMasked` (auto-hide 60s) | Travar regras de quando cada um aparece (stale só em snapshot; empty nunca com tabela vazia) |
| **P1** | `TraceSteps` (os 5 passos) + renomear `TraceabilityDrawer→Dialog` + `MfaField` (`code-input` + auto-submit) | Rastro é o diferencial do produto — merece componente próprio |
| **P2** | `Tooltip` dedicado / `Switch` / `Command-K` real / `ProjectionChart` genérico | Não criar: `title`+recharts bastam; switch proibido (§1.2); busca real é backend, não DS |
| **P2** | Carrossel Planos + Janela Rastro/Sessões (§5) | Só quando detalhe de assinatura e rastro ancórivel entrarem no roadmap — anatomia já travada aqui |

Regra de fechamento: nenhum P2 começa antes dos cinco P0 estarem extraídos dos arquivos reais acima, com os mesmos tokens (`--bg-soft/--bg-softer/--border/--accent/--danger/--ok/--warn`, `radius 8/10px`, foco `accent 2px`) e sem introduzir dependência nova.

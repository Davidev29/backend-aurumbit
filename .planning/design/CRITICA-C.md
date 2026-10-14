# CRÍTICA C — Pragmatista de escopo (admin Aurum Bit)

Premissas: time pequeno, backend com stubs (RBAC por header `x-role/x-org-id`, guards stub, workers parciais em projections/DLQ). Nenhuma decisão abaixo assume backend pronto. Tudo que não serve a `login+MFA+shell+1 CRUD` é corte.

---

## 1. O que CORTAR / ADIAR — P0 mínimo

### 1.1 Cortes nominais (sem "fase 1.5", é NÃO)

| Item (onde foi proposto) | Veredito | Motivo / custo que o time não pode pagar |
|---|---|---|
| Command-K funcional (`05 §3.2`) | **CORTAR da 1ª entrega.** Manter `SearchCmdk` stub invisível; remover trigger da topbar ou deixar inerte com `title="Em breve"` | Exige debounce, top-7, recentes em localStorage, `combobox/listbox`, polling futuro. É um produto dentro do produto. Navegação por sidebar basta para 8 rotas |
| Carrossel "Planos da assinatura" (`06 §5` uso 1) | **CORTAR.** Nem desenhar | Zero ocorrências de `carousel/slider` no código (`06 §0`). Detalhe com histórico de planos não existe no backend. Especulação pura |
| Janela "Rastro" ancorável (`06 §5` uso 2) | **CORTAR.** Rastro continua `Modal` centrado existente; **adiar até o rename** `TraceabilityDrawer→Dialog` | Janela não-modal (`role=complementary`, sem backdrop, `z-45` novo) cria 2º paradigma de overlay + comportamento mobile distinto. Custo a11y/foco sem ganho no CRUD |
| Tema light (`01` inteiro, `07 §3.1`) | **ADIAR. V1 = dark-only** | Light dobra QA de contraste (regras `accent-strong`, ring, badge) e exige sincronia `data-theme+.dark` (`07 §3.1`). Travar `data-theme="dark"`, esconder toggle (ou toggle inerte). Reintroduzir light como fatia isolada pós-v1 |
| `framer-motion` + `layoutId` pill + drag-to-dismiss + stagger (`04`, `05 §2`) | **ADIAR a dependência.** V1 = CSS `transition` em `opacity/transform` (100/160ms) | Bundle + `LazyMotion` + `MotionConfig` + 2 únicos `layoutId` para animar pill de sidebar é ouro sobre latão. Pill vira `background: var(--accent-soft)` instant; drawer/modal entram com classe CSS |
| Exceção "colapso anima `width`" (`05 §1.1`) | **CORTAR a animação.** Colapso = troca instant (ou sem colapso na v1) | `04 §3.1` proíbe animar `width`; `05` abre exceção só para o chrome. Exceção que viola a própria regra vira bug de jank + teste reduced-motion. `07 §2.3` já manda deletar `transition: width` — obedecer ao 07 |
| Tooltip Radix (`05 §2.3`) | **CORTAR. Manter `title=` + `aria-label` (`06 §2.4`)** | Nova dep (`@radix-ui/react-tooltip`) para tooltip só no modo colapsado. `title` nativo é suficiente para v1 |
| Roving tabindex + focus trap completo + `scrollIntoView` (`05 §4.3`) | **ADIAR.** V1 = `Tab` nativo + skip-link + `Esc` fecha + foco no `h1` | Roving (1 parada de Tab, setas, Home/End) é correto mas caro de testar com leitor de tela. Não é pré-requisito do CRUD |
| Tamanhos `sm/lg` de Dialog (`06 §3`) | **CORTAR.** Usar `Modal.tsx` atual (`36rem`) como está | 8 dialogs já funcionam no tamanho único. `sm/lg` é polimento sem usuário bloqueado |
| Extração `Badge/Dot/TimezoneBadge/KpiCard/Tabs/Segmented/Menu/FilterBar/Empty/Error/Stale/TraceSteps/MfaField` (`06 §6` P1) | **ADIAR tudo.** Congelar como está | `06 §0` admite: badge é "o sistema mais maduro", destrutivos são "o padrão mais consistente". Mexer no que está consistente antes de ter CRUD real é churn |
| `ProjectionChart` genérico, polling `jobs/:jobId`, exports CSV, DLQ replay (`08` fatias 5–6) | **FORA da 1ª entrega** (ver §4) | Dependem de workers parciais + endpoints CRIAR. Gráfico/projeção/export só após leitura estável |
| Migração Tailwind completa em 4 fases (`07 §2.4`) | **CONGELAR.** Não reescrever `globals.css` (719 linhas) na v1 | Fases 1–3 tocam auth→átomos→shell = todas as rotas. Com time pequeno, migração big-bang trava feature. V1 adiciona **só** bloco canônico de vars `01 §3` + aliases legados; JSX novo usa utilitárias onde couber, resto fica no CSS legado |

### 1.2 P0 mínimo que entrega valor (teto: 3 componentes)

`06 §6` propõe **5 P0** (Button, Dialog, DestructiveForm, Field, Table+Pager). Com time pequeno, 5 extrações + 8 dialogs migrados não cabem na 1ª entrega. Corte:

- **Construir (máx. 3):**
  1. `Button` — mas **sem `framer-motion`** (`m.button` de `07 §4.2` vetado na v1; botão nativo + classes). Incluir regra `disabled+title` (`06 §1.1`). Variantes: `primary/secondary/danger` + `ghost` mínimo. Sem `subtleDanger`, sem `whileTap/whileHover`.
  2. `Field + Input` (inclui `PasswordInput` simples, sem animação). Ordem `label→input→hint→erro` (`06 §4`).
  3. `Table + Pager` — extração que **elimina duplicação real** (Pager copiado em 4 páginas, `06 §1.4`). Com `caption` obrigatória e `resetPaging` embutido.
- **Reusar sem extrair:** `Modal.tsx` atual (sem `sm/lg`, sem `initialFocus` novo — manter `autoFocus` existente); `DestructiveForm` fica como **convenção copiada** (motivo≥10 + checkbox + footer), não como componente. Extrair só quando o 2º mutador provar divergência.
- **Escopo funcional da 1ª entrega:** `login (A1) + refresh/logout/me + MFA enroll/verify (A5/A6)` + **shell fixo** (sidebar 288px fixa, sem colapso animado, drawer mobile só com open/close instant, topbar com breadcrumb + avatar, sem Command-K, sem badges de contagem) + **1 CRUD de prova: Clientes lista + detalhe + busca** (cursor pager, `EmptyState`, `ErrorState`, sem export) + **1 mutador de prova** (escolher UM: `license revoke` OU `finance settle` — não os dois; o outro fica para a fatia seguinte). Tudo atrás de flag por fatia (ver §2), mock intacto quando flag ausente.

---

## 2. Riscos do plano anti-mock (`08`) — o que quebra e ordem segura

### 2.1 O que quebra se ligado (por item, sem eufemismo)

1. **Sessão JWT (`08 §2`).** Access 15min em `aurum_session` httpOnly + refresh rotativo 1-uso com **reuse detection que revoga a família inteira** (`REUSE_DETECTED` → 401 + limpa cookies). Quebra esperada: (a) duplo `refresh` concorrente (2 tabs dão 401 ao mesmo tempo → `apiFetch` dispara 2 refresh → o 2º reusa token já rotacionado → família revogada → logout fantasma); (b) cookie `ab_refresh` com `Path=/api/auth` vs `ab_refresh` do Nest com `Path=/v1/auth` — confusão na hora de repassar `Set-Cookie` no logout; (c) refresh via body evita CSRF do Nest, mas qualquer tentativa via cookie sem same-origin cai no `csrf.ts`. Mitigação: serializar refresh no BFF (lock em memória por sessão), nunca disparar refresh para `code=MFA_INVALID_CODE`, e no `REUSE_DETECTED` limpar os 3 cookies e mandar para login com mensagem "sessão revogada", sem retry.
2. **`auth/me` inexistente (`08 §1.1` A4, CRIAR).** Sem `GET /v1/auth/me` não há `permissions/organizationId` reais → `upstreamHeaders` (§0) fabrica `x-role/x-org-id` a partir de `aurum_claims` (cache JS-legível, falsificável) ou do mock. Ligar qualquer outra fatia antes de A4 = **403 em cascata** (causa #1 que `08 §0` já aponta) + risco de escalação (header `x-role: admin` derivado de dado não-confiável). A4 é pré-requisito duro de tudo.
3. **Shadowing finance (`08 §1.4` F2–F4).** `FinanceController` (core) registrado antes do flow (`finance.module.ts:36`); rotas `†` do flow (`balance`, `transactions?orgId`) estão mortas. Se o BFF chamar path do flow por engano, recebe stub/404 e o operador vê "extrato vazio" que parece dado real. Pior: `kind` (`RECEITA→INCOME`), paginação em memória e filtro `category/product` client-side **truncam silenciosamente** (teto = `limit` do Nest). Filtro por categoria com página truncada mostra total parcial como se fosse total. Mitigação: documentar o teto na UI (`hint` "filtro aplicado em N registros carregados"), nunca somar KPI sobre página truncada, e chamar só paths do core.
4. **DLQ errada (`08 §1.5` Q1/Q2).** BFF atual usa path inexistente (`/queues/dlq`); o real é `/v1/admin/dlq` com guard `DlqAdminGuard` + shape `{items,total,page,pageSize}`. Agregação por `queue` no BFF para preservar `mockDlqOverview` esconde paginação real. E o replay é **lógico, sem re-enqueue** (`TODO dlq.controller.ts:76`) — a UI que disser "re-enfileirado" mente para o operador. Mitigação: expor `mode:'logical'` no contrato BFF→UI e texto explícito "replay lógico — sem re-enqueue real"; DLQ replay é a **última** fatia a ligar.
5. **Settle sem account (`08 §1.4` F5/F6).** Nest exige `account_id` (`getAccount` + conta ativa); UI envia `{motivo,confirmacao}`. Sem conta ativa → operação impossível; `motivo` é **descartado** pelo Nest (validado no BFF e logado, mas não persistido). Quebra dupla: operador preenche motivo achando que virou trilha, e BFF que inventa "primeira active" pode baixar no caixa errado. Mitigação: BFF resolve conta via `GET /v1/finance/accounts` + env `FINANCE_DEFAULT_ACCOUNT`; sem conta → **422 `ACCOUNT_REQUIRED`** + seletor de conta na UI (previsto em `08` fatia 5 — implementar o seletor ANTES de ligar, não depois). Quando o DTO ganhar `reason?`, remover a validação duplicada.
6. **Bônus de risco que `08` subestima:** (a) `auditId` interim fake (`reveal-<id>-<ts>`, `dlq-<queue>-<ts>`) vaza para UI/auditoria como se fosse id real — marcar com prefixo e nunca usar como chave de suporte; (b) MFA mock (qualquer 6 dígitos) coexistindo com A6 real = **bypass**: matar o ramo mock asssim que A6 ligar (flag por rota, não global); (c) B3 (refund por invoice) depende de B2-a (`invoices/:id/payments`, CRIAR) — ligar B3 sem B2-a escolhe payment errado ou estorna valor errado (dinheiro real); (d) workers parciais: projeção `202 MISS` e replay podem nunca concluir — UI precisa de estado "computando" com timeout + cancelamento, não polling infinito.

### 2.2 Ordem mais segura com rollback por fatia

`08 §3` ordena `1→(2,3)→4→5→6`. Correção: **leituras antes de escritas**, DLQ replay e exports por último. E rollback **por fatia** (env por domínio), não um único `API_INTERNAL_URL` global:

| # | Fatia (revisada) | Contém | Rollback |
|---|---|---|---|
| 0 | Infra de flags | `REAL_AUTH, REAL_LICENSES_READ, REAL_BILLING_READ, REAL_FINANCE_READ, REAL_WRITES, REAL_DLQ, REAL_JOBS` (uma por domínio) + helper `upstreamHeaders` + 502 `UPSTREAM_UNAVAILABLE` (nunca fallback silencioso para stub) | Desligar a flag da fatia volta só aquele domínio ao stub; resto continua real |
| 1 | Auth (bloqueante) | Nest CRIAR A4 `me` primeiro; BFF A1/A2/A3/A5/A6 conforme `08 §2.3`; matar mock MFA no ramo real; teste login→forçar access expirado→refresh→logout→me | `REAL_AUTH=0` volta a `stub-*`; limpar os 3 cookies em `REUSE_DETECTED`/401 terminal |
| 2 | Leituras finance (dinheiro, mas só leitura) | ADAPTAR F1–F4 + CRIAR F8 `facets`; `x-org-id+x-finance-read` sempre; 403 sem `finance.read` → tela "sem acesso" (nunca lista vazia); `StaleBanner` apagado só quando `isStale:false` | `REAL_FINANCE_READ=0`; KPIs voltam ao snapshot com `StaleBanner` |
| 3 | Leituras billing + audit | CRIAR B1/B2-a/B4/B6; ADAPTAR B2 (com aba Pagamentos; vazio = "sem pagamentos", distinto de erro) | `REAL_BILLING_READ=0`; listas voltam ao mock paginado |
| 4 | Leituras licenças + DLQ leitura | ADAPTAR L1 (reveal, com `auditId` interim marcado) + Q1 agregação; verificar `LicenseReadGuard`/`DlqAdminGuard` antes (senão 403 em cascata) | `REAL_LICENSES_READ=0` / `REAL_DLQ=0` |
| 5 | Escritas (uma por vez, com idempotência) | L2/L3 → L4/L5 (CRIAR) → B5 → F5/F6 (com seletor de conta + `ACCOUNT_REQUIRED`) → B3 (só após B2-a estável); `Idempotency-Key` repassado em todas; cada escrita mantém modal motivo+confirmação | `REAL_WRITES_<domínio>=0` por operação; re-clique seguro via idempotência; erro 422 exibe `message` do Nest sem limpar o motivo digitado |
| 6 | Jobs e exports (por último) | F7 (projeção, com `202 MISS`→polling com timeout), Q2 replay lógico (com aviso explícito), B7/F10 exports, F9 trace (MOCK até B6 existir) | `REAL_JOBS=0`; projeção volta a stub, DLQ exibe `mode:logical` |

Regra de promoção: nenhuma fatia avança sem `login→refresh→logout→me` verde em staging com a flag ligada + stubs verdes com a flag desligada (critério `08` fatia 1, estendido a todas).

---

## 3. O que nos 8 docs gera retrabalho futuro

1. **3 sistemas de elevação concorrentes.** `01 §4` (`shadow-card/modal`, `specular`, raios por nível) vs `03 §3` (`--elev-0…4` + `--glass-blur/hi`) vs `06` (`--bg-soft/border`, "cards opacos, sombra só no auth-card") vs `07 §1.4` (`shadow-card/modal` como `var(--shadow-*)` com `TODO consenso: publicar no canônico`). Nenhum está no código. Escolher UM (recomendo `03`, o único com tokens coláveis) e deletar os outros dos docs, senão cada PR inventa o seu.
2. **Tokens legados vs canônicos.** `06` inteiro usa `--bg/--bg-soft/--bg-softer/--border/--text/--text-dim/--accent-ink/--ok/--warn`; `01/07` usam `--bg-0…--surface-solid/--text-1…--success`. `07 §2.1` promete aliases, mas o critério de done (`grep` zero em `07 §2.4`) nunca será atingido se código novo continuar copiando `06`. Travar: código novo usa canônico; `06` precisa de passada de rename antes de virar referência de implementação.
3. **Inventário de ícones/rotas diverge.** `03 §2.1` lista 10 rotas (`UsersRound`, `Wallet`, `Inbox`, `UserRound/KeyRound`, `Repeat2`…) vs `05 §5` lista 8 rotas (`Users`, `Landmark`, `ListOrdered`, sem Usuários/Assinaturas). Nomes de ícone também divergem (`Key` vs `KeyRound`, `Wallet` vs `Landmark`). Uma das tabelas vai para o lixo — decidir antes do wrapper `Icon.tsx`, senão troca-se import em 8+ arquivos.
4. **Tooltip: duas verdades.** `05 §2.3` trava Radix; `06 §2.4` trava `title=` e "não criar lib de tooltip (P2 no máximo)". Decisão binária pendente; do jeito atual, um dev instala Radix e outro remove no review.
5. **Breakpoint contraditório.** `05 §4.2` trava drawer em `1024px`; `07 §1` trava `md: 901px` com `TODO consenso: confirmar 901px vs 768px`. Responsivo quebra de um lado ou do outro. Travar `1024px` (valor que já existe no CSS) e apagar o TODO.
6. **Dual source de tema.** `07 §3.1` (`data-theme` + `.dark` sincronizados via script inline) vs `01` (`data-theme` sozinho). Duas fontes = flash/hidratação (`suppressHydrationWarning` já admite o problema). Com v1 dark-only (§1), o script vira 3 linhas fixas; a sincronia completa só volta com o light.
7. **`--danger-text` / `#ff9a9e` fora do canônico.** `02 §3.4` e `07 §1.1` usam `#ff9a9e` para texto de erro com `TODO: mover para 01`. Contraste AA depende de valor não-travado. Mover para `01` agora (1 linha) ou proibir o uso até lá.
8. **Finance core×flow.** `08 §1.4` assume que o core vence e o flow morre. Se o backend unificar diferente (flow absorve core, ou novos filtros `category/product`/cursor nascem no Nest), caem de uma vez: `kind`-map, divisão cents÷100 em F1, paginação em memória F2–F4, reagrupamento semanal F7 e o aviso de truncamento. Isolar esses mapeamentos num único módulo BFF (`finance-adapter.ts`) para a reescrita doer num arquivo só.
9. **RBAC real mata `08 §0`.** `upstreamHeaders` (`x-role/x-org-id/x-finance-read` a partir de `me`) + `aurum_claims` + gates `RequirePerm` são scaffolding do stub. Quando o JWT carregar `role/org/permissions`, tudo isso é deletado (BFF passa a repassar o Bearer e o Nest autoriza). Não investir em `aurum_claims` além do cache de render — está marcado para demolição.
10. **Dívidas interim que vazam para o usuário.** `auditId` fake (L1/F5/Q2), `week→monthly` com reagrupamento client-side (F7), filtro categoria client-side com teto (F2–F4), `motivo` coletado e descartado (F5/F6), `mode:logical` escondido (Q2). Cada interim precisa de marcador visível (`StaleBanner`/hint) e dono com data de remoção, senão vira comportamento permanente documentado como bug.

---

## 4. Definição de PRONTO da 1ª entrega

### 4.1 Critérios verificáveis (todos precisam passar; um falhou = não pronto)

- [ ] **Auth real atrás de flag:** com `REAL_AUTH=1` em staging: login com credencial válida → `me` retorna `{id,email,organizationId,permissions}`; access expirado (forçado ou 15min) → refresh silencioso 1x → segue logado; `REUSE_DETECTED` → cookies limpos + tela de login com "sessão revogada"; logout limpa `aurum_session/ab_refresh/aurum_claims` + repassa `Set-Cookie` do Nest. Com flag `0`: stubs passam nos mesmos cliques.
- [ ] **MFA sem bypass:** com flag ligada, código errado → `MFA_INVALID_CODE` sem disparar refresh e sem cair no login; ramo mock (qualquer 6 dígitos) inalcançável no modo real (grep: ramo `else` não executado com flag ligada).
- [ ] **Shell travado:** sidebar 288px fixa (desktop), drawer 320px open/close instant (mobile `<1024px`), skip-link → `#conteudo`, `Esc` fecha drawer/modal, foco vai ao `h1` após navegação. Sem `z-9999` (`grep z-\[9999` zero). Sem flash de largura no reload.
- [ ] **1 CRUD prova (Clientes):** lista pagina por cursor (Anterior/Próxima, `resetPaging` ao trocar filtro), busca com debounce, `EmptyState` com "Limpar filtros", `ErrorState` com retry, valores com `tabular-nums`, sem truncar dinheiro/ID sem `title`.
- [ ] **1 mutador prova:** o escolhido (revoke OU settle) exige motivo ≥10 + checkbox + `disabled+title` sem permissão; erro 422 exibe `message` sem apagar o motivo; re-clique com `Idempotency-Key` não duplica.
- [ ] **Sem regressão de contraste/a11y:** texto funcional só nos tokens AA (`01 §2` regras); `text-3` só em placeholder/caption; foco visível em todos os interativos novos; zoom 200% quebra por scroll, nunca por sobreposição.
- [ ] **Upstream honesto:** qualquer 5xx/timeout do Nest em modo real → `502 UPSTREAM_UNAVAILABLE` (nunca stub silencioso). `next build` verde; `grep` de hex solto (`bg-\[#|text-\[`) zero nos arquivos novos.

### 4.2 EXPLICITAMENTE DE FORA (pedir qualquer um reabre escopo)

Command-K funcional · carrossel de planos · janela Rastro ancorável · tema light · `framer-motion`/`layoutId`/stagger/drag · tooltip Radix · roving tabindex · colapso animado · tamanhos `sm/lg` de dialog · extração P1 (`Badge/Dot/KpiCard/Tabs/Menu/FilterBar/TraceSteps`) · projeções com polling · exports CSV · DLQ replay (leitura da DLQ pode entrar como leitura, replay não) · `finance trace` real (fica MOCK) · renames `TraceabilityDrawer→Dialog` · migração Tailwind fases 1–4 · qualquer endpoint CRIAR fora de A4 e do mutador escolhido.

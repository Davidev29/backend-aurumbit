# Landing AurumBit — Plano de Refatoração (conselho 4 skills)

> Síntese do fluxo colaborativo: **orquestrador UX/SEO** (senior-ui-ux-orchestrator +
> marketing-site-skill + seo-llm-site-architect) · **craft/anti-slop** (ui-craft +
> design-critic) · **brand/template** (open-design + concept-prototyper) ·
> **HIG/a11y** (apple-design + ux-audit + a11y-auditor). Skills instaladas em
> `.agents/skills/` e espelhadas em `.opencode/skills/` (100 skills:
> `sergekostenchuk/ui-ux-agent-skill-system`, `educlopez/ui-craft`,
> `sugarforever/open-design-skill`, `dickwu/apple-design-skill`).
> Subagentes paralelos tentados em 13/10/2026 — rate limit; auditorias da sessão
> anterior (pré-restart) reaproveitadas como evidência. Decisão final: chair humano + este plano.

## Craft Read

**Craft Read:** *landing de marketing para PMEs brasileiras pouco técnicas, linguagem de
produto (não técnica), tema dark premium + ouro, variance 6, signature bet: árvore
interativa frutos=planos.*

Knobs-alvo: `CRAFT_LEVEL 8 / MOTION_INTENSITY 4 / VISUAL_DENSITY 5 / DESIGN_VARIANCE 6`.
Direção vencedora: **A — premium escuro refinado** (lapidar o existente; B claro e C
denso viram camadas futuras, não redesign agora).

**Atualização 13/10/2026 (waves 2.0):** signature bet trocada para **globo conectado**
(`ConnectedGlobe`: nós + arcos + pulsos de informação em ritmo infinito); fundo do
banner em 4 camadas vivas (`HeroBackdrop`: aurora + orbes + grade + partículas
subindo); hero sem framing de planos — cada programa tem licença individual
(mensal/anual), detalhes por produto;
narrativa offline mudou para **"100% offline por natureza — a internet só valida a
licença"** (sem contagem de dias); checkout próprio em `/checkout`; refresh token
com rotação no BFF.

## Regra do conselho (desempate)

1. Segurança/privacidade/LGPD · 2. Acessibilidade e tarefa primária · 3. Fatos visíveis
   verdadeiros · 4. HTML semântico + crawlability/LLM-readable · 5. Conversão/compreensão ·
   6. Consistência Figma/design-system · 7. Manutenibilidade · 8. Novidade visual.

## O que foi executado (Fase 1 — esta refatoração)

### SEO/AEO/GEO — `app/layout.tsx`, `app/page.tsx`, `app/robots.ts`, `app/sitemap.ts`
- Metadata realinhada ao copy SMB (offline, Pix/boleto, preço claro, ajuda em PT).
- `canonical` + `alternates`, `robots` com `max-image-preview:large`.
- `viewport`: `viewportFit: cover` + `colorScheme: "dark light"`.
- JSON-LD no server component: `Organization+WebSite`, `SoftwareApplication` (Base/Pro/
  Enterprise, preços BRL reais do catálogo), `FAQPage` (6 Q&A), `HowTo` (3 passos).
- `robots.ts` + `sitemap.ts` novos. Preços continuam SSR (`mockCatalogPage` no server).

### Ordem e CTA — `app/page.tsx`
- `ServicesSection` movida para depois de `HowItWorksSection` (sob-medida via `mailto:`
  fora do funil self-serve). Navbar inalterada (âncoras continuam válidas).
- 1 primário por viewport mantido; rótulos específicos preservados.

### Craft anti-slop — hero, headings, tokens, repetição
- Hero: 6 camadas de fundo → 2 (orbes + grade); removidos `BlockField`, `ParticleField`,
  cursor-glow, `Magnetic`, `TextReveal` (H1 estático = LCP imediato), `animate-gold-breathe`,
  `animate-ping`, scroll-cue infinito.
- `SectionHeading`: `eyebrow` opcional + H2 em `text-section` (novo,
  `clamp(1.75rem,4vw,2.5rem)` — H1 > H2 restaurado).
- `text-gradient-gold` reservado ao Hero + FinalCTA; demais títulos usam `text-accent`.
- Hairlines duplicados por seção removidos; `btn-shine` removido do Hero.
- `glass-card:hover` e `Card[hover]` sem `shadow-glow` (glow só em CTA primário/foco).
- `mesh-gradient` sem matiz azul (`#1A1A2E` → neutro).
- Stats de vaidade (`3 planos`/`3 formas` com Counter) → faixa de prova estática
  (1 frase + 3 bullets com número real: 7/30 dias, 1/3/50+ máquinas, Pix/boleto/cartão).
- Tokens: camada primitive `--gold-*` + `--info-ink` no light; `--text-3` dark
  `#5A5A5E` → `#8A8A8E` (contraste AA em corpo pequeno).

### HIG/a11y bloqueantes
- `Modal`: `useId()` estável + focus-trap leve + restaura foco + `aria-modal`.
- `Input`: `useId()` estável + prop `rightInteractive` (botão mostrar-senha clicável).
- `TreeGrowth`: frutos sem `outline:none`; `aria-pressed` → `aria-expanded` + anel de foco
  visível via `stroke`; teclado mantido.
- `Navbar`: alvos 44px (hambúrguer, fechar, itens), sem `role` redundante, scroll respeita
  `prefers-reduced-motion`, safe-area no drawer.
- `Hero`: `<dl>` inválido → `<ul>` semântico; botão fechar do fruit-card 44px;
  anúncio `role="status"` só em ativação (não no hover).
- `ProductsSection`: `aria-busy` + erro PT amigável (sem `e.message` cru).
- `globals.css`: `prefers-reduced-motion` cobre hero/ping/marquee + `scroll-behavior:auto`;
  `forced-colors` para `.text-gradient-gold`; `prefers-reduced-transparency` zera glows.
- Safe-area: `viewportFit` + padding `env()` no drawer/modal.
- Tema dark forçado documentado como decisão de marca em `apps/portal/DESIGN.md`
  (light tokens preservados; dual-theme QA fica para fase 2).

### Brand/template — `apps/portal/DESIGN.md` + `apps/portal/.open-design.json`
- Fonte única de verdade visual + binding per-project (seções, tokens, constraints).

## Fase 2 (executada em 13/10/2026 — waves A/B/C via subagentes + implementação)

1. ✅ Tabela comparativa inline (`components/products/ComparePlans.tsx`, preços BRL do
   SSR, Pro em destaque, CTA por coluna, Enterprise via `mailto:`).
2. ✅ Sticky mobile CTA pós-hero (`components/layout/StickyCta.tsx`, esconde em
   `#produtos`, safe-area, `tabIndex` condicional).
3. ✅ FAQ pagamento/cancelamento/fiscal reescrito só com fatos do codebase
   (`Faq.tsx` + `FAQS` de `page.tsx` sincronizados com o JSON-LD).
4. ✅ Prova honesta: `lib/company.ts` (whatsapp/cnpj `undefined` → não renderizam),
   placeholder `wa.me/5500000000000` removido do Footer; social icons 44px.
5. ✅ `app/llms.txt/route.ts` + `SummarySection` (resumo citável após o hero).
6. ✅ Dual-theme (`next-themes`, `defaultTheme: system`, `ThemeToggle` desktop+mobile).
7. ✅ `--font-accent` restrito ao logo (regra no DESIGN.md; sem depoimento inventado).

## Verificação (Fase 2)

## Waves 2.0 (13/10/2026 — 4 subagentes de mapeamento + implementação)

1. ✅ **Hero globo conectado** (`components/motion/ConnectedGlobe.tsx`): esfera SVG com
   meridianos/paralelos, ~10 nós, 6 arcos tracejados, 12 pulsos `animateMotion` em
   ritmo infinito desencontrado; `TreeGrowth.tsx` removida; interação via botões HTML
   (chips Base/Pro/Enterprise com `aria-expanded` + hub destacado no globo).
2. ✅ **Copy offline sem dias** (`100% offline por natureza — a internet só valida a
   licença`): grep confirma zero ocorrências de `7 dias|30 dias|offlineDays` em
   `app/`, `components/`, `lib/`; FAQ/JSON-LD/llms/metadata/tabela/modal/mocks alinhados.
3. ✅ **Cards compactos** (`ProductCard` reescrito: contexto + título + preço-âncora
   `A partir de` + economia anual + 3 diferenciais + CTA único; sem faixa de imagem
   vazia) + **seção "Desenvolvimento sob medida para o seu CNPJ"** (faixa de escopo,
   timeline compacta, CTA `mailto` com subject do CNPJ).
4. ✅ **Checkout elegante** (`app/checkout/` público + `noindex`): resumo do produto/
   plano via `?code=&plan=`, comprador (pré-preenchido via `getMe`), Pix/boleto/cartão,
   confirmação via BFF `POST /api/me/checkout` (proxy upstream ou stub com total real);
   modal "Continuar" leva ao checkout sem perder o plano.
5. ✅ **Refresh token**: `POST /api/auth/refresh` com rotação; `GET /api/auth/me` com
   retry reativo 1x; `bffFetch` com voo único + retry 1x fora de `/api/auth/*`.
   Backlog: check `Origin` nos POST do BFF, prefixo `__Host-`, expor revoke no logout.

## Waves 3.0 (13/10/2026 — banner vivo, licença individual, cadastro)
   `spin-slow`, `rise`, `halo-breathe`): aurora atravessando, anel cônico girando
   atrás do globo, 26 partículas subindo, halo respirando — só transform/opacity,
   tudo off em `prefers-reduced-motion`.
2. ✅ **Hero sem planos**: chips e cartão de plano removidos; licença individual
   (mensal/anual) no copy; detalhes por produto nas seções abaixo. CTAs viraram
   "Ver programas e preços" em todo o site; modal "Escolha como pagar".
3. ✅ **Cadastro elaborado**: wizard em 2 etapas (Você → Senha e termos) com
   indicador `aria-current`, modal `lg` no modo register, faixa de benefícios,
   checkbox de termos com `label` associado e alvo 44px. Contrato da API inalterado.

## Waves 3.1 — tabela comparativa removida → vitrine por produto
- `ComparePlans.tsx` excluída (seção rejeitada). No lugar: `ProductSpotlight.tsx` —
  fileiras editoriais alternadas por programa (categoria, argumento, máquinas/offline/
  suporte, até 4 diferenciais do catálogo, preço-âncora + "licença individual",
  CTA "Ver detalhes" abre o modal; Enterprise com "Proposta sob medida" + `mailto:`).
- Foco visível por teclado no `ProductCard` (`focus-visible:ring`).

## Waves 4.0 — consumo, checkout com ID, dashboard e licença por e-mail

**Respostas (com evidência):**
1. **Admin→portal reflete?** Só com `API_INTERNAL_URL` + Nest/PG no ar + produto `ACTIVE`
   (atraso ≤60s ISR/hidratação). Sem backend, o admin-stub nunca reflete e a primeira
   pintura é sempre mock. Endurecido: `GET /v1/products` agora é `@Public()` de verdade
   (era "leitura aberta" só no comentário), `GET :code/plans` + `GET plans/all` novos, e
   o BFF enriquece+normaliza (`lib/nest-catalog.ts`) para catálogos sem `plans[]` não
   quebrarem os cards.
2. **Comprar→login mantém o ID?** NÃO mantinha (`AuthModal` ia sempre para `/dashboard`).
   Agora mantém: `openAuthModal(mode, { returnTo })` + `consumeReturnTo()` (só paths
   internos) no `portal-context`; wrapper redireciona ao `returnTo`; "Entrar" do checkout
   volta para `/checkout?code=&plan=`. Pagamento real exige backend+Asaas (stub `chk-*`
   sem cobrança); checkout agora envia `paymentMethod` + `successUrl/cancelUrl`.
3. **Dashboard funcional?** UI completa e funcional (lista, reveal auditado com cópia,
   skeleton/erro/vazio); com backend usa BFF real, sem backend usa mocks. Chave em texto
   puro só via reveal. Achado e corrigido: `GET /v1/licenses?mine=1` não existia no Nest
   (sem filtro válido → 400) — implementado via identity do JWT (convenção
   `ownerId` = identityId, documentada em `docs/ACTIVATION.md`).

**Licença por e-mail + ativação dupla (funcional e robusto):**
- Nest `POST /v1/licenses/activate-by-key` (`@Public()`, rate-limit `licenseReveal`,
  anti-enumeração `404 KEY_INVALID`, link de device + offline-token, log sem PII) +
  `LicensesService.findByKeyHash` + testes da suíte verdes (429 testes, 44 suítes).
- BFF `POST /api/me/licenses/activate` — modo conta recomendado: resolve e-mail→licenças
  (`?mine=1`), vincula device, emite offline-token; stub honesto marcado `stub:true`.
- Dashboard: cartão "Como ativar" (conta recomendado vs chave) + cópia mascarada honesta.
- Contrato dos instaladores em `docs/ACTIVATION.md` (códigos de erro, `DEVICE_LIMIT`,
  `off_exp`, nunca HMAC/log de chave no cliente).
- Backlog honesto: pagamento→licença automática (worker pendente em `licenseHooks[]`),
  `Origin`-check no BFF, `__Host-`, revoke no logout.

## Verificação (Waves 2.0)
- `pnpm --dir apps/portal build` (ou `tsc --noEmit`) após as edições.
- Conferir: sem `text-gradient-gold` fora de Hero/FinalCTA/logo; sem `shadow-glow` fora de
  CTA primário; H1 único estático; JSON-LD válido (Rich Results Test).

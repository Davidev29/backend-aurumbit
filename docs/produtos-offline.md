# Produtos com licenças offline — ciclo de vida e consumo pela ferramenta

> Escopo: como um produto nasce no admin, como a licença chega ao comprador e
> como a ferramenta 100% offline consome/valida com segurança. Fonte normativa:
> `.planning/PROJECT.md` (§1 offline/graça, §2 chaves) + `docs/design-system/DS.md`.
> Estado atual: **backend real ligado** (Nest + PG + disco VPS); stubs do BFF
> servem só sem `API_INTERNAL_URL`. Admin: `apps/admin/app/(app)/produtos`.

## 1. Criar o produto (admin → `/produtos` → Novo produto)

1. **Nome da ferramenta** (≥3) + código/slug únicos (409 em colisão).
2. **Regras básicas:** máquinas simultâneas (1–100; `machines_allowed`).
3. **Formas de pagamento:** preço mensal e/ou anual em centavos — **imutável**:
   novo preço = nova linha de plano (`POST /v1/plans` + activate), anterior
   arquivada com `supersededBy`. Contratos fechados mantêm o preço congelado;
   só novas cobranças usam o vigente.
4. **Galeria demonstrativa:** upload `image/*` até 5 MB (`POST
   /v1/products/:code/images`, multipart campo `file`) em disco na VPS
   (`PRODUCT_IMAGES_DIR`, fora do repo; servido com cache em
   `GET /v1/product-images/:filename`; remoção apaga linha + bytes).
   **Sem carrossel no admin** (DS v1 proíbe) — a galeria alimenta carrosséis
   externos/vitrine via API.
5. Leitura do catálogo é aberta; escrita exige `product.manage` (TODO RBAC real)
   + `x-role: admin` no BFF→Nest.

## 1. Criar o produto (admin → `/produtos` → Novo produto)

1. **Nome da ferramenta** (≥3) + código/slug auto-derivados (únicos — 409 em colisão).
2. **Regras básicas:** máquinas simultâneas (1–100, enforcement `FOR UPDATE` no backend).
3. **Formas de pagamento:** preço mensal e/ou anual (centavos, ao menos um; preço é
   imutável — novo preço = novo plano, espelho de `CreatePlanDto`).
4. **Galeria demonstrativa:** upload em sessão (thumbs + remover; **sem carrossel no
   admin** — DS v1 proíbe; a galeria alimenta carrosséis externos/vitrine via API).
   TODO backend: `POST /v1/products/:code/images` + object storage + CDN.
5. Leitura do catálogo é aberta; escrita exige `product.manage` (mock admin já tem;
   TODO backend: RBAC real).

## 2. Compra → licença do produto (na efetividade da compra, NUNCA na tela do produto)

- `POST /v1/licenses` (`IssueLicenseDto`: ownerType/ownerId/productId/planId?/
  kind monthly|annual) — PG, outbox `LicenseIssued`, `ownerLabel` opcional p/
  agregados sem lookup cross-schema.
- Resposta: `{ license: MaskedLicense, key }`. O **plaintext `AURUM-XXXX-XXXX-XXXX`
  (CSPRNG 128-bit) trafega UMA única vez**; o banco guarda só `key_hash`
  (SHA256 UNIQUE) + prefixo/últimos-4 + `key_enc` (envelope via
  `LICENSE_MASTER_KEY_PATH`; sem a mestra, reveal responde 409 por desenho).
  UI/logs nunca têm a chave (PROJECT §2).
- Vigência inicia na **confirmação do pagamento** (`starts_at`), `expires_at` =
  calendário UTC 1M/12M, `grace_until = expires_at + 3d`.

## 3. Não pagou → renovar com troca (`POST /v1/licenses/:id/renew` + revoke)

- O renew do core **cria NOVA licença** (nova chave, continuidade
  `starts_at = max(now, expires_at)`); revogada/suspensa/pendente não renova
  (409). A anterior é **desativada com motivo + `replacedBy`** (bump
  `token_version`, invalida JWTs/offline-tokens no próximo online) e
  **preservada no histórico PG** (`GET /v1/licenses/:id/history`, outbox
  append-only: motivo, encerrada em, substituída por).
- Enquanto **estiver pagando, o acesso persiste**: cada renovação emite nova
  chave com continuidade (sem lacuna); a renovação-com-troca ainda desativa a
  anterior com motivo auditado.

## 4. Consumo pela ferramenta 100% offline (contrato seguro)

```
ativar:   usuário informa product_id + chave (uma vez) → app valida formato
          ^AURUM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$ → POST online .../check
          (+ device_hash = HMAC(segredo_rotativo, license_id || app_instance_id),
          nunca hardware cru) → guarda { license_id, product_id, lic_exp,
          grace_until, off_exp, token_version } (+ offline-token c/ teto 7d)
uso:      now <= lic_exp e now <= off_exp → ALLOW
          lic_exp < now <= grace_until e now <= off_exp → ALLOW degradado
          (banner, sem ações destrutivas)
          now > grace_until → DENY EXPIRED · now > off_exp → DENY OFFLINE_EXPIRED
troca:    chave antiga negada (revogada/expirada) → app pede a nova chave;
          revalidar online renova off_exp (teto: min(token_iat+7d, expires_at+7d))
```

Regras robustas (nunca flexibilizar no client):
- Chave em repouso: preferir `key_enc`-like local (OS keychain/DPAPI); nunca logar,
  nunca exibir além dos 4 finais.
- Relógio: desconfiar de retrocesso (monotônico); `off_exp` nunca estende validade.
- Rede: retry com backoff + idempotência; 5xx/timeout ≠ licença inválida (manter
  último estado + avisar, nunca auto-bloquear por falha de rede).
- `token_version` divergente no online → revalidar e derrubar sessão local.

# Ativação de licenças — conta (recomendado) ou chave

Este documento é o contrato para os apps clientes (Win/Mac/Web/App, fora deste
repo) e para o portal. Nada aqui é mock: os endpoints citados existem e os
comportamentos de stub estão marcados.

## Os dois modos (o instalador oferece nesta ordem)

1. **Entrar na conta (recomendado)** — a licença é encontrada pelo e-mail logado,
   sem digitar nada. O servidor vincula o dispositivo e devolve um offline-token.
2. **Digitar a chave** — alternativa para quem prefere não logar no instalador.

## Modo A — conta (via portal BFF)

`POST /api/me/licenses/activate` (cookies httpOnly, nunca o token no JS).

```json
{ "productId": "opaco (opcional)", "app_instance_id": "uuid-da-instalação", "label": "PC do caixa" }
```

Resposta `ActivationResult`:

```json
{
  "mode": "account", "licenseId": "lic-…", "keyMasked": "••••-WXYZ",
  "productId": "…", "expiresAt": "…", "graceUntil": "…",
  "device_hash": "hex64", "offlineToken": "jwt", "off_exp": "…", "token_version": 1
}
```

Erros: `401 UNAUTHORIZED/REVOKED` (logar de novo), `404 ACCOUNT_NO_LICENSE`
(esta conta não tem licença ativa → oferecer modo chave), `409 DEVICE_LIMIT`
(liberar um slot em `/dashboard/sistemas`), `502 UPSTREAM_UNAVAILABLE`.

Sem backend (`API_INTERNAL_URL` ausente): stub honesto com `stub: true`,
`device_hash`/`offlineToken` prefixados `stub-` — só para desenvolvimento local.

## Modo B — chave (direto no Nest, sem conta)

`POST /v1/licenses/activate-by-key` — pública (`@Public()`), rate-limit global
(preset `licenseReveal`, por IP), sem PII em log.

```json
{ "key": "AURUM-XXXX-XXXX-XXXX", "app_instance_id": "uuid-da-instalação", "label": "PC do caixa" }
```

Resposta: mesmo `ActivationResult` com `"mode": "key"` (sem `keyMasked`? com —
mascarada). Erros: `404 KEY_INVALID` (genérico de propósito — igual para chave
inexistente e malformada, anti-enumeração), `403 LICENSE_INACTIVE` (suspensa,
revogada, expirada ou aguardando pagamento), `409 DEVICE_LIMIT`/`DEVICE_CONFLICT`,
`403 DEVICE_BLOCKED`.

## Regras que o instalador deve seguir

- Tentar **conta primeiro**; cair para **chave** só em `ACCOUNT_NO_LICENSE`.
- Guardar `offlineToken` + `app_instance_id`; **nunca** derivar HMAC no cliente
  (o segredo é só do servidor) e **nunca** logar a chave.
- Validação periódica: `POST /v1/licenses/:id/validate` (HTTP 200 sempre; o corpo
  diz `allow/deny` — sem retry-storm). Offline: vale o `offline_token` até `off_exp`
  (mínimo entre `iat+7d` e expiração+7d).
- Limite de dispositivos: `409 DEVICE_LIMIT` → orientar a liberar um slot na
  dashboard (`/dashboard/sistemas`), não a criar conta nova.

## Convenções de dados (não quebrar)

- Licenças de cliente usam `ownerType='CUSTOMER'` e **`ownerId` = identityId do JWT**
  — é assim que `GET /v1/licenses?mine=1` resolve e-mail→licenças sem guardar
  e-mail na tabela `licenses` (LGPD, sem cross-DB).
- Chave: formato `AURUM-XXXX-XXXX-XXXX`; no banco só `key_hash` (SHA256) + trechos
  mascarados; plaintext só em `issue` (1x) e `reveal` auditado (10/h).
- Renovação cria **nova linha** (`starts_at = max(now, expires)`); `tokenVersion`
  invalida offline-tokens antigos.

## Lacunas conhecidas (não escondidas)

- Pagamento→licença ainda é manual: webhook `CONFIRMED` empilha `licenseHooks[]`
  (`billing-flow.service.ts`) sem emitir a licença — worker pendente.
- `GET /v1/products` agora é público e inclui planos via BFF; o portal normaliza
  (`lib/nest-catalog.ts`) para catálogos sem `plans[]`/`gallery` não quebrarem cards.
- Checkout sem backend é stub (`chk-*`, sem Asaas); com backend, proxya o Nest e
  redireciona para `asaasUrl` quando presente.

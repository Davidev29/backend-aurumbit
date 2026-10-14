# ADR-003 — Token offline 7d (sem GPS)

- Status: **aceita** (Fase 3)
- Data: 2026-10-10
- Vincula: `PROJECT.md` §§1–2/4, `docs/LGPD.md`, `docs/RUNBOOKS/licensing.md`

## Contexto

O app precisa funcionar sem contato com o servidor por até 7 dias
(teto operacional), sem nunca estender a validade da licença além do
contratado + tolerância. Revogação deve invalidar tokens no próximo
online. Geolocalização precisa é vedada (LGPD: finalidade/retenção).

## Decisão

1. **`off_exp = min(iat + 7d, expires_at + 7d)`** (epoch; `iat` = emissão do
   token). Vitalícia (`lic_exp null`) → `iat + 7d`. Servidor **recomputa**
   `off_exp` no parse — cliente nunca estende a janela.
2. **Precedência (grace vence offline)**: `status` (`REVOKED`/`SUSPENDED`
   negam) → `token_version` (mismatch = stale/revogado) → `now > grace_until`
   → `DENY EXPIRED` (**mesmo com `off_exp` válido**) → `now > off_exp` →
   `DENY OFFLINE_EXPIRED` (exige online) → `now <= lic_exp` → `ALLOW` →
   senão (dentro da graça + `off_exp` válido) → `ALLOW degradado`
   (`degraded:true`, banner, sem ações destrutivas).
3. **Renovação em grace mantém continuidade**: `starts_at = max(now,
   expires_at anterior)`; novo token carrega nova `lic_exp`/`grace_until`.
4. **Revogação/rotate bump `token_version`**; token antigo falha fechado no
   próximo online (`TOKEN_VERSION_MISMATCH`/`TOKEN_STALE`).
5. **Sem GPS**: token carrega só `lid/tv/iat/exp/grace/off` (+ `iss/sub/
   owner/product/feat/dev/ctr/jti` no JWT canônico). Nenhum campo de
   localização; validação offline é pura (sem I/O, sem rede, sem geo).
   Geo por IP, quando usada, é aproximada, só em memória, p/ sinal
   `cloned_suspect` — nunca persistida.
6. Assinatura: HMAC-SHA256 local (stub Fase 3, segredo via env/KMS);
   migração p/ ES256/KMS com `kid` já prevista (header carrega `kid`).

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Teto só `iat + 7d` (sem `min` com `expires+7d`) | Licença expirada ganharia 7d cheios de uso pós-expiração além da graça de 3d |
| Grace estendida pelo offline (`off_exp` prorroga `grace_until`) | Viola §1: graça é tolerância contratual fixa, não renovável offline |
| GPS no token p/ antifraude | Vedado pela finalidade (LGPD.md); hardware/geo crus nunca saem do request |

## Consequências

- (+) App tolera 7d offline com semântica auditável; e2e `offline` trava
  `off_exp`, `EXPIRED`-vence-`OFFLINE_EXPIRED` e ausência de GPS.
- (+) Revogação é eventual (próximo online) — documentado no runbook.
- (−) Relógio do device deslocado pode negar precocemente; tolerância de
  `iat` futuro (5min) mitiga sem abrir janela de clone.

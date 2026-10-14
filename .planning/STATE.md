# STATE.md (rev. 2026-10-14)

- Etapa: Fases 1–6 concluídas (builds PASS, unit 377, e2e 42). Nova etapa planejada:
  Fases 7–10 em ROADMAP.md (produção VPS → modelo comercial/capabilities →
  app_<slug> → sync bidirecional). Fase 7 detalhada em PHASE-7-PLAN.md,
  pronta para execução.

- Etapa: new-project revisado, Fase 1 planejada sem código, aguardando revisão do usuário.
- Correções gravadas em PROJECT.md §§1-6:
  1. Offline: `off_exp=min(iat+7d, expires+7d)`; grace 3d vence mesmo offline; validação ALLOW/degradado/DENY explícita.
  2. Chaves: `key_hash` UNIQUE + prefix/last4 + `key_enc` KMS; só `keyMasked`; reveal auditado+MFA+rate-limit.
  3. `finance.read` manager = explícito, escopado por org, default deny (sobrescreve "liberado por padrão").
  4. IP só hash 90d, device_hash licença+12m, sem GPS; geo-IP só memória p/ clone suspect.
  5. Idempotência `UNIQUE(provider,externalId)` + `jobId=eventId`; fora de ordem não regride; reconciliação hourly+daily.
  6. Templates `deposit/withdrawal/order-filled` marcados FORA; 14 templates reais listados.
- Preservado: monólito modular, 9 DBs, titular ambos, vigência=pagamento, graça 3d, offline 7d, BullMQ+Outbox, Next.js admin.
- Concluído: Fases 1–6 + ARCHITECTURE.md + README.md. Builds PASS, unit 377, e2e 42.
- Fase 7 executada em 2026-10-14 (report em `.planning/PHASE-7-REPORT.md`):
  código+scripts T0–T8 prontos e verificados localmente (bash -n 15/15, compose
  config semântico, tsc portal, unit api 429/429). Corrigido bug load-bearing:
  `!reset` zerava ports/depends_on no Compose v5.4.0 → `!override`.
  Pendente de VPS/Linux: up real, caddy validate, seed-prod, backup cron,
  smoke --live, clone→ready <10min real, reboot, monitores externos.

# Uptime externo — 3 hosts (Fase 7 T6)

Fonte: `deploy/obs/uptime-targets.json` (editar o JSON, este md é o passo a passo).
Sem isso, falha só aparece quando o usuário liga (PLAN §5 T6).

## 1. Alvos

| # | Nome | URL | Intervalo | Asserts |
|---|------|-----|-----------|---------|
| 1 | `aurumbit-apex-home` | `https://aurumbit.com/` | 300s | status 200 + corpo contém `produtos` |
| 2 | `aurumbit-admin-home` | `https://admin.aurumbit.com/` | 300s | status 200 |
| 3 | `aurumbit-api-live` | `https://api.aurumbit.com/health/live` | 180s | status 200 + corpo contém `"status":"ok"` |

API com intervalo menor (180s): é o caminho de webhook/checkout; apex/admin em 300s
cabe no plano gratuito do UptimeRobot (50 monitores / 5 min).

## 2. Cadastro (UptimeRobot)

1. Dashboard → Add New Monitor → Monitor Type `HTTP(s)`.
2. Friendly Name = `name` do JSON; URL = `url` do JSON.
3. Monitoring Interval = 5 min (monitores 1–2) — o monitor 3 usa 3 min (requer plano
   pago; no free, manter 5 min e registrar a divergência aqui).
4. Keyword: monitor 1 → `produtos`; monitor 3 → `"status":"ok"` (Alert When
   Keyword Not Exists). Monitor 2 sem keyword.
5. Alert Contacts: criar `ops-email` (e-mail do plantão) e `ops-slack` (Slack
   webhook) no provedor — **nunca commitar URLs/tokens neste repo**.
6. Repetir para os 3 monitores; conferir status `Up` após 2 ciclos.

## 3. Cadastro (Better Stack — alternativa)

1. Uptime → Create monitor → URL do JSON; Check frequency 3 min (api) / 5 min (demais).
2. Request timeout 15s; Expected status `200`; Expected keyword conforme §1.
3. Escalation: `ops-email` + `ops-slack`; incident após 2 falhas consecutivas.
4. Call routing / on-call só se o time adotar plantão formal (fora desta fase).

## 4. Em alerta

1. Confirmar se é global: `deploy/scripts/smoke-prod.sh --dry-run` da VPS e de fora.
2. API fora → `docs/RUNBOOKS/health.md` (restart, DLQ, outbox).
3. Billing/webhook sob suspeita → `docs/RUNBOOKS/webhook-replay.md`.
4. Falso-positivo (1 flap isolado): anotar data/hora; 2 falhas seguidas = incidente.

## 5. Revisão

- Mensal: conferir os 3 monitores `Up` + contatos válidos (e-mail do plantão atual).
- Pós-incidente: ajustar keyword/intervalo se o monitor não pegou a falha real.

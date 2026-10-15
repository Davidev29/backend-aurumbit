# Runbook — /health, /ready, /metrics (Fase 1)

Alvos: `apps/api` (T2) expõe; `libs/observability` implementa; CI/CD faz smoke.

## 1. Endpoints

| Endpoint | Significado | Resposta OK |
|---|---|---|
| `GET /health/live` | Liveness: processo responde (sem dependências) | `200 {"status":"ok"}` |
| `GET /health/ready` | Readiness: PG + Redis acessíveis | `200 {"status":"ok","postgres":"up","redis":"up"}`; senão `503 {"status":"degraded",...}` |
| `GET /metrics` | Prometheus (prom-client); CI exige `http_requests_total` | `200` texto exposition |

```bash
curl -fsS http://localhost:3000/health/live
curl -fsS http://localhost:3000/health/ready
curl -fsS http://localhost:3000/metrics | grep http_requests_total
```

Sempre enviar/preservar `x-correlation-id` (gerado se ausente); incluí-lo no chamado de suporte.

## 2. Diagnóstico rápido

| Sintoma | Causa provável | Ação |
|---|---|---|
| `/live` 200, `/ready` 503 `postgres:down` | PG fora do ar, migração pendente, `DATABASE_URL` errada | `docker compose ps`; `docker compose logs postgres`; `bash deploy/scripts/migrate-all.sh`; checar `deploy/init-dbs.sh` criou o banco `aurumbit` + 9 schemas |
| `/live` 200, `/ready` 503 `redis:down` | Redis fora do ar / `REDIS_URL` errada | `docker compose ps`; `redis-cli -u $REDIS_URL ping`; `docker compose restart redis` |
| `/live` sem resposta | api crashou / porta ocupada | `docker compose logs api --tail=200` (procurar `FATAL`); `lsof -i :3000`; `docker compose up --build -d api` |
| `/metrics` sem `http_requests_total` | Interceptor de métricas não registrado (T2) | Verificar registro do middleware `http_requests_total` em `apps/api`; `turbo run build` + redeploy |
| Tudo 200 mas CI e2e falha | `.env` divergente do `.env.example` | `diff .env .env.example` (sem vazar segredos no log); `cp .env.example .env` e recompor segredos via gerenciador |

## 3. Timeouts

- Cada check do `/ready` tem timeout ~2 s (`withTimeout` em `libs/observability`): lentidão vira `down`, não trava o endpoint.
- Smoke CI aguarda até ~5 min (`/health/ready` em loop); CD HML/PROD falha o deploy se o smoke não passar.

## 4. Pós-incidente

1. Anotar `x-correlation-id` + horário + payload do `/ready`.
2. Exportar `docker compose logs --tail=500 api workers postgres redis`.
3. Registrar em `audit.security.event` se houve indisponibilidade com impacto (Fase 4+).

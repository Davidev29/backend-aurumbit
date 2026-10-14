/**
 * Health checks — Fase 1, sem negócio.
 * Contratos consumidos por `apps/api` (T2) e pelo smoke do CI/CD:
 * - GET /health/live  → 200 { status: "ok" } (liveness, sem dependências)
 * - GET /health/ready → 200 { status, postgres, redis } ou 503 se down
 */

export type DependencyStatus = "up" | "down";

export interface ReadyPayload {
  status: "ok" | "degraded";
  postgres: DependencyStatus;
  redis: DependencyStatus;
}

export interface HealthChecker {
  checkPostgres(): Promise<DependencyStatus>;
  checkRedis(): Promise<DependencyStatus>;
}

export function buildReadyPayload(
  postgres: DependencyStatus,
  redis: DependencyStatus,
): { httpStatus: 200 | 503; body: ReadyPayload } {
  const ok = postgres === "up" && redis === "up";
  return {
    httpStatus: ok ? 200 : 503,
    body: { status: ok ? "ok" : "degraded", postgres, redis },
  };
}

export async function buildReady(checker: HealthChecker): Promise<{
  httpStatus: 200 | 503;
  body: ReadyPayload;
}> {
  const [postgres, redis] = await Promise.all([
    checker.checkPostgres().catch((): DependencyStatus => "down"),
    checker.checkRedis().catch((): DependencyStatus => "down"),
  ]);
  return buildReadyPayload(postgres, redis);
}

export function buildLive(): { httpStatus: 200; body: { status: "ok" } } {
  return { httpStatus: 200, body: { status: "ok" } };
}

/** Timeout helper p/ checks não travarem o /ready (T2 usa ~2s por dependência). */
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

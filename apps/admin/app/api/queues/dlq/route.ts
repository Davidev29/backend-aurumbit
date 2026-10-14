import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import { mockDlqOverview } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

interface NestDlqEntry {
  queue?: string;
  jobId?: string;
  eventId?: string;
  reason?: string;
  enqueuedAt?: string;
  replayedAt?: string | null;
}

/**
 * BFF `GET /api/queues/dlq` → Nest `GET /v1/admin/dlq` (Fase 6, real).
 * Agrega itens em profundidade por fila (pendentes = `replayedAt == null`).
 * Stub auditado (`lib/mocks.ts`) sem `API_INTERNAL_URL`.
 * Headers: Bearer (cadeia global) + x-role admin + x-mfa verified (ponte
 * stub até o step-up MFA real — TODO auth real).
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/admin/dlq?pageSize=100`, {
        headers: {
          ...upstreamAuthHeaders(session),
          "x-mfa": "verified",
        },
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        items?: NestDlqEntry[];
      };
      if (!upstream.ok) {
        return NextResponse.json(data, { status: upstream.status });
      }
      const pending = (data.items ?? []).filter((e) => e.replayedAt == null);
      const byQueue = new Map<
        string,
        { queue: string; depth: number; oldestEnqueuedAt: string | null; lastError: string | null }
      >();
      for (const e of data.items ?? []) {
        const queue = typeof e.queue === "string" ? e.queue : "unknown.dlq";
        if (!byQueue.has(queue)) {
          byQueue.set(queue, { queue, depth: 0, oldestEnqueuedAt: null, lastError: null });
        }
      }
      for (const e of pending) {
        const queue = typeof e.queue === "string" ? e.queue : "unknown.dlq";
        const slot = byQueue.get(queue) ?? { queue, depth: 0, oldestEnqueuedAt: null, lastError: null };
        slot.depth += 1;
        if (!slot.oldestEnqueuedAt && typeof e.enqueuedAt === "string") slot.oldestEnqueuedAt = e.enqueuedAt;
        if (!slot.lastError && typeof e.reason === "string") slot.lastError = e.reason;
        byQueue.set(queue, slot);
      }
      return NextResponse.json({
        queues: Array.from(byQueue.values()),
        isStale: false,
        asOf: new Date().toISOString(),
      });
    } catch {
      // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(mockDlqOverview());
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockDlqReplay } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/queues/dlq/:queue/replay` → Nest
 * `POST /v1/queues/dlq/:queue/replay` (re-enfileira + audit `queue.replay`).
 * Exige `billing.manage` (só admin) + motivo >= 10 + `confirmacao: true`;
 * o backend real valida e responde 403 sem a permissão.
 * Stub: registra a intenção localmente até o backend real da Fase 6 existir.
 */
export async function POST(req: NextRequest, { params }: { params: { queue: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as { motivo?: unknown; confirmacao?: unknown };

  if (typeof body.motivo !== "string" || body.motivo.trim().length < 10 || body.confirmacao !== true) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Replay exige motivo >= 10 caracteres + confirmacao: true." },
      { status: 400 },
    );
  }

  if (API_INTERNAL_URL) {
    // Real: `POST /v1/admin/dlq/:queue/replay` (lote lógico idempotente +
    // audit `dlq.replay`; `mode: 'logical'` exposto — sem re-enqueue real).
    // Headers: Bearer + x-role admin + x-mfa verified (ponte stub — TODO).
    try {
      const upstream = await fetch(
        `${API_INTERNAL_URL}/v1/admin/dlq/${encodeURIComponent(params.queue)}/replay`,
        {
          method: "POST",
          headers: {
            ...upstreamAuthJsonHeaders(session),
            "x-mfa": "verified",
            ...(req.headers.get("Idempotency-Key")
              ? { "Idempotency-Key": req.headers.get("Idempotency-Key") as string }
              : {}),
          },
          body: JSON.stringify({ limit: 100 }),
        },
      );
      const data = (await upstream.json().catch(() => ({}))) as {
        queue?: string;
        mode?: string;
        replayed?: number;
      };
      if (!upstream.ok) {
        return NextResponse.json(data, { status: upstream.status });
      }
      // Estabiliza o contrato da UI (`{queue, replayed, auditId}`).
      return NextResponse.json({
        queue: data.queue ?? params.queue,
        mode: data.mode ?? "logical",
        replayed: data.replayed ?? 0,
        auditId: `dlq-${params.queue}-${Date.now()}`,
      });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  // TODO(backend real Fase 6): remover stub — replay real + audit `queue.replay` no Nest.
  return NextResponse.json(mockDlqReplay(params.queue));
}

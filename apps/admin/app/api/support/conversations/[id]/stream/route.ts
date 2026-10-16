import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * SSE do admin por conversa (`GET .../stream`, sem token — sessão httpOnly).
 * Com upstream: proxy do Nest com a sessão staff (o EventSource do browser não
 * envia headers, mas o fetch server-to-server do BFF pode). Sem upstream:
 * heartbeat (o polling de 3s hidrata).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(
        `${API_INTERNAL_URL}/v1/support/conversations/${encodeURIComponent(params.id)}/stream`,
        { headers: { Accept: "text/event-stream", ...upstreamAuthHeaders(session) } }
      );
      if (upstream.body) {
        return new Response(upstream.body, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
        });
      }
    } catch {
      /* heartbeat abaixo */
    }
  }
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      try {
        controller.enqueue(enc.encode(`data: {"kind":"presence","conversationId":"${params.id}","at":"${new Date().toISOString()}"}\n\n`));
      } catch {
        /* noop */
      }
      const timer = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(timer);
        }
      }, 15000);
      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* noop */
        }
      });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

import type { NextRequest } from "next/server";
import { getUpstreamBase, isMockAllowed } from "@/lib/upstream";
import { supportGet } from "@/lib/support-store";

/**
 * SSE do visitante (`GET .../stream?token=`).
 * - Com upstream: faz proxy do stream do Nest (repasse byte-a-byte).
 * - Sem upstream (dev): long-poll suave — mantém a conexão aberta e envia
 *   `message` quando novas mensagens chegam (poll 1s, heartbeat 15s).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const t = req.nextUrl.searchParams.get("token") ?? req.headers.get("x-chat-token") ?? "";
  const base = getUpstreamBase();
  if (base) {
    try {
      const upstream = await fetch(
        `${base}/v1/support/conversations/${encodeURIComponent(params.id)}/stream?token=${encodeURIComponent(t)}`,
        { headers: { Accept: "text/event-stream" } }
      );
      if (!upstream.ok || !upstream.body) {
        return new Response(`data: {"kind":"presence","conversationId":"${params.id}","at":"${new Date().toISOString()}"}\n\n`, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
        });
      }
      return new Response(upstream.body, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
      });
    } catch {
      /* cai no modo local */
    }
  }
  if (!isMockAllowed()) {
    return new Response(`data: {"kind":"presence"}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  const s = supportGet(params.id);
  const startLen = s?.messages.length ?? 0;
  let last = startLen;
  let heartbeat = 0;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* fechado */
        }
      };
      send({ kind: "presence", conversationId: params.id, at: new Date().toISOString(), presence: { onlineAgents: 1, onlineVisitors: 1 } });
      const timer = setInterval(() => {
        const cur = supportGet(params.id);
        if (!cur) {
          clearInterval(timer);
          try {
            controller.close();
          } catch {
            /* noop */
          }
          return;
        }
        if (cur.messages.length > last) {
          for (let i = last; i < cur.messages.length; i++) {
            send({ kind: "message", conversationId: params.id, at: cur.messages[i].createdAt, message: cur.messages[i] });
          }
          last = cur.messages.length;
        }
        heartbeat += 1;
        if (heartbeat % 15 === 0) send({ kind: "presence", conversationId: params.id, at: new Date().toISOString() });
      }, 1000);
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

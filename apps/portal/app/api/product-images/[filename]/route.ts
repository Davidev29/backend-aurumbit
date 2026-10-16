import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUpstreamBase, isMockAllowed } from "@/lib/upstream";

/**
 * Proxy same-origin da galeria (`/api/product-images/<filename>` → Nest
 * `GET /v1/product-images/<filename>`).
 *
 * Por que proxy e não URL absoluta do Nest:
 * - CSP do portal (`default-src 'self'`) liberaria só mesma origem;
 * - evita mixed-content e CORS no `<img>`/`<video>` do modal;
 * - `next/image` segue com allowlist fechada (sem host novo).
 *
 * Segurança: `filename` é basename puro (sem `/`, `\`, `..`, nulo) — o Nest
 * também valida e responde 404 no resto. Cache público de 1 dia (bytes
 * imutáveis: filename = uuid+ext).
 */
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: { filename: string } }
) {
  const filename = decodeURIComponent(params.filename ?? "");
  if (!SAFE_FILENAME.test(filename) || filename.includes("..")) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "Mídia não encontrada." },
      { status: 404 }
    );
  }

  const base = getUpstreamBase();
  if (!base) {
    if (isMockAllowed()) {
      return NextResponse.json(
        { code: "UPSTREAM_MISSING", message: "Backend indisponível em dev." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { code: "UPSTREAM_MISSING", message: "Backend indisponível." },
      { status: 502 }
    );
  }

  const upstream = await fetch(
    `${base}/v1/product-images/${encodeURIComponent(filename)}`,
    { next: { revalidate: 86400 } }
  ).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "Mídia não encontrada." },
      { status: upstream?.status === 404 ? 404 : 502 }
    );
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const contentLength = upstream.headers.get("content-length");
  if (contentType) headers.set("Content-Type", contentType);
  if (contentLength) headers.set("Content-Length", contentLength);
  headers.set("Cache-Control", "public, max-age=86400, immutable");
  return new NextResponse(upstream.body, { status: 200, headers });
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF item da galeria (VPS disk no backend).
 * - `GET` faz proxy dos bytes (`GET /v1/product-images/:filename`, com
 *   content-type/length do upstream) — mesma origem p/ o `<img>`.
 * - `DELETE` remove linha + arquivo (`DELETE /v1/products/:code/images/:id`).
 * Stub: 501 honesto (bytes vivem no backend). Escrita exige `product.manage`.
 */
export async function GET(req: NextRequest, { params }: { params: { code: string; id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (!API_INTERNAL_URL) {
    return NextResponse.json(
      { code: "NOT_IMPLEMENTED", message: "Bytes da galeria exigem backend." },
      { status: 501 },
    );
  }
  try {
    // Resolve id → filename pelo detalhe (o proxy expõe só o id estável).
    const detail = await fetch(`${API_INTERNAL_URL}/v1/products/${encodeURIComponent(params.code)}`, {
      headers: upstreamAuthHeaders(session),
    });
    const detailData = (await detail.json().catch(() => ({}))) as {
      images?: Array<{ id?: string; filename?: string; mime?: string }>;
    };
    if (!detail.ok) {
      return NextResponse.json(detailData, { status: detail.status });
    }
    const img = (detailData.images ?? []).find((i) => i.id === params.id) ?? null;
    if (!img?.filename) {
      return NextResponse.json({ code: "NOT_FOUND", message: "Imagem não encontrada." }, { status: 404 });
    }
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/product-images/${encodeURIComponent(img.filename)}`,
      { headers: upstreamAuthHeaders(session) },
    );
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ code: "NOT_FOUND", message: "Imagem não encontrada." }, { status: 404 });
    }
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type") ?? img.mime ?? "application/octet-stream";
    headers.set("content-type", contentType);
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
    headers.set("cache-control", "public, max-age=86400");
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch {
    return NextResponse.json(
      { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
      { status: 502 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { code: string; id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (!API_INTERNAL_URL) {
    return NextResponse.json(
      { code: "NOT_IMPLEMENTED", message: "Remoção da galeria exige backend." },
      { status: 501 },
    );
  }
  try {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/products/${encodeURIComponent(params.code)}/images/${encodeURIComponent(params.id)}`,
      { method: "DELETE", headers: upstreamAuthHeaders(session) },
    );
    if (upstream.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import type { ProductImage } from "@/lib/types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const MAX_BYTES = 5 * 1024 * 1024;

interface NestImage {
  id?: string;
  filename?: string;
  originalName?: string;
  mime?: string;
  size?: number;
  createdAt?: string;
}

function toProductImage(code: string, img: NestImage): ProductImage {
  return {
    id: typeof img.id === "string" ? img.id : "",
    name: img.originalName ?? img.filename ?? "imagem",
    size: img.size ?? 0,
    previewUrl: `/api/products/${encodeURIComponent(code)}/images/${encodeURIComponent(img.id ?? "")}`,
    sessao: false,
  };
}

/**
 * BFF galeria do produto (VPS disk no backend).
 * - `GET` lista (`GET /v1/products/:code` já inclui `images`; aqui normalizado
 *   p/ `ProductImage` com `previewUrl` no proxy do BFF — mesma origem,
 *   CSP `img-src 'self'`).
 * - `POST` recebe multipart (`file`, image/* ≤ 5MB) e repassa ao Nest
 *   (`POST /v1/products/:code/images`). Stub: 501 honesto (sem backend não há
 *   onde persistir bytes — sessão guarda só metadados).
 * Escrita exige `product.manage` (UI gate + backend 403).
 */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (!API_INTERNAL_URL) {
    return NextResponse.json(
      { code: "NOT_IMPLEMENTED", message: "Galeria persistida exige backend (stub guarda só metadados em sessão)." },
      { status: 501 },
    );
  }
  try {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/products/${encodeURIComponent(params.code)}`, {
      headers: upstreamAuthHeaders(session),
    });
    const data = (await upstream.json().catch(() => ({}))) as { images?: NestImage[] };
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    return NextResponse.json((data.images ?? []).map((img) => toProductImage(params.code, img)));
  } catch {
    return NextResponse.json(
      { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (!API_INTERNAL_URL) {
    return NextResponse.json(
      { code: "NOT_IMPLEMENTED", message: "Upload exige backend (stub guarda só metadados em sessão)." },
      { status: 501 },
    );
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Campo `file` (imagem) é obrigatório." },
      { status: 422 },
    );
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Apenas imagens (image/*)." },
      { status: 422 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Imagem até 5 MB." },
      { status: 422 },
    );
  }
  try {
    const forward = new FormData();
    forward.append("file", file);
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/products/${encodeURIComponent(params.code)}/images`,
      {
        method: "POST",
        headers: upstreamAuthHeaders(session),
        body: forward,
      },
    );
    const data = (await upstream.json().catch(() => ({}))) as NestImage;
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    return NextResponse.json(toProductImage(params.code, data), { status: 201 });
  } catch {
    return NextResponse.json(
      { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
      { status: 502 },
    );
  }
}

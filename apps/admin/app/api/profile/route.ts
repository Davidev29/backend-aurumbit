import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_ADMIN } from "@/lib/mocks";

/**
 * BFF `GET /api/profile` — perfil estendido do operador (stub).
 * TODO(backend pronto): proxy real p/ Nest `GET /v1/users/me`
 * (foto/documentos em object storage + CDN; números mascarados no backend).
 */
export async function GET() {
  return NextResponse.json({
    nomeExibicao: MOCK_ME_ADMIN.name,
    nomeCompleto: MOCK_ME_ADMIN.name,
    email: MOCK_ME_ADMIN.email,
    telefone: "",
    celular: "",
    dataNascimento: null,
    genero: "",
    cargo: "Administradora",
    departamento: "",
    bio: "",
    fotoPreviewUrl: null,
    fotoNome: null,
    endereco: { pais: "Brasil" },
    documentos: [],
    updatedAt: new Date().toISOString(),
  });
}

/**
 * BFF `PATCH /api/profile` — atualização parcial (stub valida + ecoa).
 * TODO(backend pronto): proxy real p/ Nest `PATCH /v1/users/me`
 * (validação com class-validator + audit `user.profile_updated`).
 */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.nomeExibicao === "string" && body.nomeExibicao.trim().length < 2) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Nome muito curto (mín. 2 caracteres)." },
      { status: 422 },
    );
  }
  if (typeof body.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return NextResponse.json({ code: "UNPROCESSABLE", message: "E-mail inválido." }, { status: 422 });
  }
  return NextResponse.json({ ...body, updatedAt: new Date().toISOString() });
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import QRCode from "qrcode";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

function base32(buf: Buffer): string {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alpha[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) out += alpha[(acc << (5 - bits)) & 31];
  return out;
}

/**
 * BFF `POST /api/auth/mfa/enroll` — cadastra o autenticador (TOTP).
 * Com backend: proxy p/ Nest `POST /v1/auth/mfa/enroll` (exige sessão real).
 * Sem backend (mock): gera segredo demo + `otpauth://` p/ cadastrar no app.
 */
export async function POST(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }

  if (API_INTERNAL_URL) {
    const auth = req.headers.get("authorization");
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/auth/mfa/enroll`, {
      method: "POST",
      headers: { ...(auth ? { Authorization: auth } : {}) },
    });
    const data = (await upstream.json().catch(() => ({}))) as { otpauthUrl?: string };
    if (upstream.ok && data.otpauthUrl) {
      const qrDataUrl = await QRCode.toDataURL(data.otpauthUrl, { width: 256, margin: 1 });
      return NextResponse.json({ ...data, qrDataUrl }, { status: upstream.status });
    }
    return NextResponse.json(data, { status: upstream.status });
  }

  const secret = base32(randomBytes(20));
  const otpauthUrl = `otpauth://totp/AurumBit:admin?secret=${secret}&issuer=AurumBit`;
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 256, margin: 1 });
  return NextResponse.json({ secret, otpauthUrl, qrDataUrl, warning: "SHOW_ONCE", mock: true });
}

import { NextResponse } from "next/server";

const SESSION_COOKIE = "aurum_portal_session";
const REFRESH_COOKIE = "aurum_portal_refresh";

/** BFF `POST /api/auth/logout` — limpa cookies httpOnly. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return res;
}

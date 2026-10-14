import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "aurum_portal_session";

/**
 * Middleware do Portal — protege /dashboard e redireciona visitantes
 * não autenticados de volta à landing. Rotas públicas: /, /api/auth/*,
 * /api/products, assets estáticos.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/products") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/products/") ||
    pathname.match(/\.(png|jpg|jpeg|svg|ico|webmanifest)$/);

  if (isPublic) return NextResponse.next();

  if (pathname.startsWith("/dashboard")) {
    const hasSession = req.cookies.has(SESSION_COOKIE);
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.set("login", "1");
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

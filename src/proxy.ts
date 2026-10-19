import { NextRequest, NextResponse } from "next/server";

/**
 * Next 16 proxy (formerly middleware).
 *
 * Scope: COARSE gating only — cookie presence + redirects. This runs on the
 * Edge runtime, so it cannot query Postgres. Authoritative session/permission
 * checks happen server-side via src/lib/auth/guards.ts in every page and
 * route handler.
 */

const SESSION_COOKIE = "ems_session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);
const PUBLIC_PREFIXES = ["/_next", "/favicon.ico", "/api/auth/logout"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // API routes: 401 JSON instead of a redirect.
  if (pathname.startsWith("/api/")) {
    if (!hasSession) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: "Please sign in." },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  // Pages: redirect to login (with return path), or home → dashboard.
  if (!hasSession) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/") {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = "/dashboard";
    dashUrl.search = "";
    return NextResponse.redirect(dashUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

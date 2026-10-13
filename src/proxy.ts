import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "ad_session";

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

function withCors(request: NextRequest, response: NextResponse) {
  // All origins are allowed. Credentialed requests can't use a wildcard "*",
  // so the request's own origin is echoed back instead.
  const origin = request.headers.get("origin");
  if (!origin) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Vary", "Origin");
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api");
  const isAdminApi = pathname.startsWith("/api/admin");

  if (isApi && request.method === "OPTIONS") {
    return withCors(request, new NextResponse(null, { status: 204 }));
  }

  if (!pathname.startsWith("/dashboard") && !isAdminApi) {
    return withCors(request, NextResponse.next());
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.JWT_SECRET;

  if (!token || !secret) {
    if (isAdminApi) {
      return withCors(request, NextResponse.json({ error: "Not authenticated" }, { status: 401 }));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    // Only checks the token is valid. The role inside it is frozen at login, so the
    // admin check is left to requireAdmin() in each route, which reads the current role.
    await jwtVerify(token, new TextEncoder().encode(secret));

    return withCors(request, NextResponse.next());
  } catch {
    if (isAdminApi) {
      return withCors(request, NextResponse.json({ error: "Not authenticated" }, { status: 401 }));
    }
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};

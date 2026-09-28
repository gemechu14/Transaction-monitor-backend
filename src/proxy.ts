import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "ad_session";

// Comma-separated list of exact frontend origins allowed to call this API
// with credentials, e.g. "http://localhost:3000,https://tm.coopbankoromiasc.com".
// Credentialed requests can't use a wildcard origin, so unlisted origins get no CORS headers at all.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

function withCors(request: NextRequest, response: NextResponse) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) {
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
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const user = payload.user as { role?: string } | undefined;

    if (isAdminApi && user?.role !== "ADMIN") {
      return withCors(request, NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }

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

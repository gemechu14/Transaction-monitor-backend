import { NextResponse } from "next/server";
import { authenticateUser, LdapUnavailableError } from "@/lib/ldap";
import { createSession } from "@/lib/session";
import { db } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const identifier = String(body.identifier ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Username/email and password are required" },
        { status: 400 }
      );
    }

    const ip = getClientIp(request);
    const ipLimit = checkRateLimit(`ip:${ip}`);
    const identifierLimit = checkRateLimit(`id:${identifier}`);
    if (!ipLimit.allowed || !identifierLimit.allowed) {
      const retryAfterSeconds = Math.max(
        ipLimit.retryAfterSeconds,
        identifierLimit.retryAfterSeconds
      );
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
      );
    }

    // 1. Local gate — reject before ever touching AD
    const localUser = await db.user.findUnique({ where: { email: identifier } });
    if (!localUser || localUser.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // 2. AD is still the password authority
    const adUser = await authenticateUser(identifier, password);
    if (!adUser) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // 3. Sync AD attributes + last login
    const updated = await db.user.update({
      where: { id: localUser.id },
      data: {
        displayName: adUser.displayName,
        username: adUser.username,
        lastLoginAt: new Date(),
      },
    });

    await createSession({
      userId: updated.id,
      email: adUser.email,
      displayName: adUser.displayName,
      givenName: adUser.givenName,
      username: adUser.username,
      distinguishedName: adUser.distinguishedName,
      role: updated.role,
    });

    return NextResponse.json({
      success: true,
      user: {
        displayName: adUser.displayName,
        email: adUser.email,
        username: adUser.username,
        role: updated.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    if (error instanceof LdapUnavailableError) {
      return NextResponse.json(
        {
          error:
            "Active Directory is temporarily unreachable. Please try again.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Authentication service unavailable" },
      { status: 500 }
    );
  }
}

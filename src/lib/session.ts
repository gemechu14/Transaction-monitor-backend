import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { UserInfo } from "./ldap";

const SESSION_COOKIE = "ad_session";
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

export type SessionUser = Pick<
  UserInfo,
  "email" | "displayName" | "givenName" | "username" | "distinguishedName"
> & {
  userId: string;
  role: "ADMIN" | "USER";
};

// `NODE_ENV=production` alone doesn't mean the site is served over HTTPS
// (e.g. next start on a plain-HTTP internal IP), and a Secure cookie is
// silently dropped by the browser over HTTP. Let deployments opt in explicitly.
function isSecureCookie() {
  if (process.env.COOKIE_SECURE) {
    return process.env.COOKIE_SECURE === "true";
  }
  return process.env.NODE_ENV === "production";
}

function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return (payload.user as SessionUser) ?? null;
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

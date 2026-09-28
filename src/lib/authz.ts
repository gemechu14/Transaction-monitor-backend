import { getSession, type SessionUser } from "./session";

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new UnauthorizedError("Not authenticated");
  if (user.role !== "ADMIN") throw new ForbiddenError("Admin role required");
  return user;
}

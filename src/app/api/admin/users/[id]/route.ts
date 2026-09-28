import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/authz";
import { db } from "@/lib/db";

function handleError(e: unknown) {
  if (e instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  console.error(e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const user = await db.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ user });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json();
    const data: { role?: "ADMIN" | "USER"; status?: "ACTIVE" | "DISABLED" } = {};
    if (body.role === "ADMIN" || body.role === "USER") data.role = body.role;
    if (body.status === "ACTIVE" || body.status === "DISABLED") data.status = body.status;

    const user = await db.user.update({ where: { id }, data });
    return NextResponse.json({ user });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    // Disable rather than hard-delete to preserve audit history
    const user = await db.user.update({ where: { id }, data: { status: "DISABLED" } });
    return NextResponse.json({ user });
  } catch (e) {
    return handleError(e);
  }
}

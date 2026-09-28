import { NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/authz";
import { db } from "@/lib/db";

function handleAuthError(e: unknown) {
  if (e instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  console.error(e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

function parseRole(value: string | null): "ADMIN" | "USER" | undefined {
  return value === "ADMIN" || value === "USER" ? value : undefined;
}

function parseStatus(value: string | null): "ACTIVE" | "DISABLED" | undefined {
  return value === "ACTIVE" || value === "DISABLED" ? value : undefined;
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim().toLowerCase() || undefined;
    const role = parseRole(searchParams.get("role"));
    const status = parseStatus(searchParams.get("status"));

    const users = await db.user.findMany({
      where: {
        email: search ? { contains: search } : undefined,
        role,
        status,
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ users });
  } catch (e) {
    return handleAuthError(e);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = body.role === "ADMIN" ? "ADMIN" : "USER";

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    const user = await db.user.create({
      data: { email, role, status: "ACTIVE", createdBy: admin.email ?? undefined },
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    return handleAuthError(e);
  }
}

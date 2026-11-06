import { NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/authz";
import { db } from "@/lib/db";

const SOURCE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_LENGTH = { description: 300, ownerName: 120, ownerEmail: 254 } as const;

function handleError(e: unknown) {
  if (e instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  console.error(e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

/** Trimmed text, `null` for empty (clears the field), `undefined` when not sent (left as is). */
function readText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

type RouteContext = { params: Promise<{ source: string }> };

// Creates the channel's row on first save, so channels need no seeding.
export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { source } = await params;
    if (!SOURCE_PATTERN.test(source)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const ownerEmail = readText(body.ownerEmail);
    const data = {
      description: readText(body.description),
      ownerName: readText(body.ownerName),
      ownerEmail: ownerEmail ? ownerEmail.toLowerCase() : ownerEmail,
    };
    for (const [field, max] of Object.entries(MAX_LENGTH)) {
      const value = data[field as keyof typeof data];
      if (value && value.length > max) {
        return NextResponse.json({ error: `${field} must be at most ${max} characters` }, { status: 400 });
      }
    }
    if (data.ownerEmail && !EMAIL_PATTERN.test(data.ownerEmail)) {
      return NextResponse.json({ error: "Owner email is not valid" }, { status: 400 });
    }

    const updatedBy = admin.email ?? undefined;
    const channel = await db.channelInfo.upsert({
      where: { source },
      create: { source, ...data, updatedBy },
      update: { ...data, updatedBy },
    });
    return NextResponse.json({ channel });
  } catch (e) {
    return handleError(e);
  }
}

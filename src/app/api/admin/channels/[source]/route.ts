import { NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/authz";
import { parseChannelPatch, toChannelResponse } from "@/lib/channel-info";
import { db } from "@/lib/db";

const SOURCE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

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
    // The saved type and months decide whether the patched result is valid.
    const saved = await db.channelInfo.findUnique({
      where: { source },
      select: { channelType: true, activeMonths: true },
    });
    const parsed = parseChannelPatch(body, saved);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const updatedBy = admin.email ?? undefined;
    const channel = await db.channelInfo.upsert({
      where: { source },
      create: { source, ...parsed.data, updatedBy },
      update: { ...parsed.data, updatedBy },
    });
    return NextResponse.json({ channel: toChannelResponse(channel) });
  } catch (e) {
    return handleError(e);
  }
}

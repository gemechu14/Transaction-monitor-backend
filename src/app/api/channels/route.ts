import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

// Any signed-in user can read channel details: the dashboard shows the
// descriptions on hover. Editing is admin-only, under /api/admin/channels.
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const channels = await db.channelInfo.findMany({ orderBy: { source: "asc" } });
  return NextResponse.json({ channels });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ user });
}

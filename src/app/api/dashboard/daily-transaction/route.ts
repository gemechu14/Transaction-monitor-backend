import { NextResponse } from "next/server";
import {
  INVALID_PARAMS,
  errorResponse,
  parseDateRange,
  unauthorizedResponse,
  upstreamErrorResponse,
} from "@/lib/dashboard-api";
import { getSession } from "@/lib/session";
import { fetchDailyTransaction, toWso2DailySource } from "@/lib/wso2";

// `source` defaults to `all` and is matched case-insensitively.
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return unauthorizedResponse();
  }

  const { searchParams } = new URL(request.url);
  const range = parseDateRange(searchParams);
  if ("error" in range) {
    return range.error;
  }
  const { startDate, endDate } = range;
  const requested = searchParams.get("source")?.trim() || "all";
  const source = toWso2DailySource(requested);
  if (!source) {
    return errorResponse(400, INVALID_PARAMS, `Unknown source "${requested}"`);
  }

  const result = await fetchDailyTransaction(source, startDate, endDate);
  if (!result.ok) {
    return upstreamErrorResponse(result.status, result.message);
  }
  return NextResponse.json({
    success: true,
    message: "Daily transactions fetched successfully",
    data: result.data,
  });
}

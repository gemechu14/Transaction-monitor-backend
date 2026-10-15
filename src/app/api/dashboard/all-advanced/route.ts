import { NextResponse } from "next/server";
import { parseDateRange, unauthorizedResponse, upstreamErrorResponse } from "@/lib/dashboard-api";
import { getSession } from "@/lib/session";
import { fetchAllAdvanced } from "@/lib/wso2";

// `source` is accepted for parity with WSO2's URL but ignored: allAdvanced
// always returns every source.
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return unauthorizedResponse();
  }

  const range = parseDateRange(new URL(request.url).searchParams);
  if ("error" in range) {
    return range.error;
  }

  const result = await fetchAllAdvanced(range.startDate, range.endDate);
  if (!result.ok) {
    return upstreamErrorResponse(result.status, result.message);
  }
  return NextResponse.json({
    success: true,
    message: "Total transactions fetched successfully",
    data: result.data,
  });
}

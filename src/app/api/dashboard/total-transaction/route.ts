import { NextResponse } from "next/server";
import {
  INVALID_PARAMS,
  errorResponse,
  parseDateRange,
  unauthorizedResponse,
  upstreamErrorResponse,
} from "@/lib/dashboard-api";
import { getSession } from "@/lib/session";
import { fetchAllSourcesTotals, fetchSourceTotals, isWso2Source } from "@/lib/wso2";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return unauthorizedResponse();
  }

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source")?.trim().toLowerCase() ?? "";
  if (!source) {
    return errorResponse(400, INVALID_PARAMS, "startDate, endDate, and source are required parameters");
  }
  const range = parseDateRange(searchParams);
  if ("error" in range) {
    return range.error;
  }
  const { startDate, endDate } = range;
  if (!isWso2Source(source)) {
    return errorResponse(400, INVALID_PARAMS, `Unknown source "${source}"`);
  }

  if (source === "all") {
    const totals = await fetchAllSourcesTotals(startDate, endDate);
    if (totals.failedSources.length === totals.bySource.length) {
      return errorResponse(502, "An unexpected error occurred", "Failed to fetch total transactions from every source system");
    }
    return NextResponse.json({
      success: true,
      message: "Total transactions fetched successfully",
      data: { source, startDate, endDate, ...totals },
    });
  }

  const result = await fetchSourceTotals(source, startDate, endDate);
  if (!result.ok) {
    return upstreamErrorResponse(result.status, result.message);
  }
  return NextResponse.json({
    success: true,
    message: "Total transactions fetched successfully",
    data: {
      source,
      startDate,
      endDate,
      totalTransactions: result.totalTransactions,
      totalAmount: result.totalAmount,
    },
  });
}

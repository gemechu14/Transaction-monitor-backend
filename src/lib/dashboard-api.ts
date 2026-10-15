import { NextResponse } from "next/server";

export const INVALID_PARAMS = "Invalid or missing query parameters";

/** The `{ success: false, message, error: { code, details } }` envelope every dashboard route uses. */
export function errorResponse(status: number, message: string, details: string) {
  return NextResponse.json(
    { success: false, message, error: { code: status, details } },
    { status },
  );
}

export function upstreamErrorResponse(status: number, details: string) {
  return errorResponse(status, status === 400 ? INVALID_PARAMS : "An unexpected error occurred", details);
}

// Accepts only real calendar dates in YYYY-MM-DD form (rejects 2026-02-30).
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Reads and checks `startDate`/`endDate`; returns a 400 response when they're missing or invalid. */
export function parseDateRange(
  searchParams: URLSearchParams,
): { startDate: string; endDate: string } | { error: NextResponse } {
  const startDate = searchParams.get("startDate")?.trim() ?? "";
  const endDate = searchParams.get("endDate")?.trim() ?? "";

  if (!startDate || !endDate) {
    return { error: errorResponse(400, INVALID_PARAMS, "startDate and endDate are required parameters") };
  }
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return { error: errorResponse(400, INVALID_PARAMS, "startDate and endDate must be valid dates in YYYY-MM-DD format") };
  }
  if (startDate > endDate) {
    return { error: errorResponse(400, INVALID_PARAMS, "startDate must be on or before endDate") };
  }
  return { startDate, endDate };
}

export function unauthorizedResponse() {
  return errorResponse(401, "Unauthorized access", "Not authenticated");
}

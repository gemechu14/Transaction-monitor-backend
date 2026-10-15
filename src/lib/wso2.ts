export const WSO2_CHANNEL_SOURCES = [
  "tas",
  "ips_incoming",
  "ips_push",
  "coopapp",
  "jica",
  "eeu",
  "souflle",
  "hajj",
] as const;

export type Wso2ChannelSource = (typeof WSO2_CHANNEL_SOURCES)[number];
export type Wso2Source = Wso2ChannelSource | "all";

export function isWso2Source(value: string): value is Wso2Source {
  return value === "all" || (WSO2_CHANNEL_SOURCES as readonly string[]).includes(value);
}

export interface TransactionTotals {
  totalTransactions: number;
  totalAmount: number;
}

export type SourceTotalsResult =
  | ({ source: Wso2ChannelSource; ok: true } & TransactionTotals)
  | { source: Wso2ChannelSource; ok: false; status: number; message: string };

export interface AllSourcesTotals extends TransactionTotals {
  bySource: SourceTotalsResult[];
  failedSources: Wso2ChannelSource[];
}

const DEFAULT_BASE_URL = "https://wso2mi.coopbankoromiasc.com";
const DEFAULT_TIMEOUT_MS = 15_000;

function getConfig() {
  const timeout = Number(process.env.WSO2_TIMEOUT_MS);
  return {
    baseUrl: (process.env.WSO2_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    token: process.env.WSO2_API_TOKEN,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

function upstreamMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { message, error } = body as { message?: unknown; error?: { message?: unknown; details?: unknown } };
  const candidate = error?.message ?? error?.details ?? message;
  return typeof candidate === "string" ? candidate : undefined;
}

type Wso2CallResult =
  | { ok: true; data: unknown; text: string }
  | { ok: false; status: number; message: string };

/**
 * GETs a WSO2 dashboard path and returns the `data` of a successful reply.
 * Network errors, timeouts, invalid JSON and failed replies come back as
 * `ok: false` with the status this backend should send: 400 for WSO2
 * validation errors, 504 for timeouts, otherwise 502 (including a 401 from
 * WSO2, which is our config problem, not the user's session).
 */
async function callWso2(path: string, params: Record<string, string>, label: string): Promise<Wso2CallResult> {
  const { baseUrl, token, timeoutMs } = getConfig();
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Not application/json: with that Accept header WSO2's totalTransaction
        // leaves the totals empty (`"totalTransactions": ,`) even when the channel has data.
        Accept: "*/*",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    console.error(`WSO2 request failed (${label})`, e);
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      message: timedOut ? "WSO2 did not respond in time" : "WSO2 is unreachable",
    };
  }

  // WSO2 sometimes sends malformed JSON (e.g. `"totalTransactions": ,` for tas),
  // so read the text and parse it ourselves rather than calling response.json().
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`WSO2 returned invalid JSON (${label}, status=${response.status}): ${text.slice(0, 300)}`);
    return { ok: false, status: 502, message: "WSO2 returned an invalid response" };
  }

  if (response.status === 400) {
    return { ok: false, status: 400, message: upstreamMessage(body) ?? "Invalid request" };
  }
  if (!response.ok || (body as { success?: unknown } | null)?.success !== true) {
    console.error(`WSO2 request failed (${label}, status=${response.status}): ${text.slice(0, 300)}`);
    return {
      ok: false,
      status: 502,
      message: upstreamMessage(body) ?? `WSO2 request failed with status ${response.status}`,
    };
  }

  return { ok: true, data: (body as { data?: unknown }).data, text };
}

/** Reads `{ totalTransactions, totalAmount }`, or undefined if either isn't a number. */
function parseTotals(value: unknown): TransactionTotals | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { totalTransactions, totalAmount } = value as Record<string, unknown>;
  if (typeof totalTransactions !== "number" && typeof totalTransactions !== "string") return undefined;
  if (typeof totalAmount !== "number" && typeof totalAmount !== "string") return undefined;
  const count = Number(totalTransactions);
  const amount = Number(totalAmount);
  if (!Number.isFinite(count) || !Number.isFinite(amount)) return undefined;
  // WSO2 sends counts as floats (`37.0`) and amounts in exponent form (`1.17E9`).
  return { totalTransactions: Math.round(count), totalAmount: Math.round(amount * 100) / 100 };
}

export async function fetchSourceTotals(
  source: Wso2ChannelSource,
  startDate: string,
  endDate: string,
): Promise<SourceTotalsResult> {
  const label = `totalTransaction source=${source}`;
  const result = await callWso2("/wso2Dashboard/totalTransaction", { startDate, endDate, source }, label);
  if (!result.ok) {
    return { source, ok: false, status: result.status, message: result.message };
  }

  const totals = parseTotals(result.data);
  if (!totals) {
    console.error(`WSO2 returned no totals (${label}): ${result.text.slice(0, 300)}`);
    return { source, ok: false, status: 502, message: "WSO2 returned an invalid response" };
  }
  return { source, ok: true, ...totals };
}

/**
 * Sums every channel ourselves instead of calling WSO2 with source=all, which
 * currently answers 0/0 with HTTP 500 while the individual channels have data.
 * Channels that fail are left out of the totals and listed in `failedSources`.
 */
export async function fetchAllSourcesTotals(startDate: string, endDate: string): Promise<AllSourcesTotals> {
  const bySource = await Promise.all(
    WSO2_CHANNEL_SOURCES.map((source) => fetchSourceTotals(source, startDate, endDate)),
  );

  let totalTransactions = 0;
  let totalAmount = 0;
  const failedSources: Wso2ChannelSource[] = [];
  for (const result of bySource) {
    if (result.ok) {
      totalTransactions += result.totalTransactions;
      totalAmount += result.totalAmount;
    } else {
      failedSources.push(result.source);
    }
  }

  return {
    totalTransactions,
    totalAmount: Math.round(totalAmount * 100) / 100,
    bySource,
    failedSources,
  };
}

export type AllAdvancedResult =
  | { ok: true; data: Record<string, TransactionTotals> }
  | { ok: false; status: number; message: string };

/**
 * Every source's totals in one WSO2 call, keyed by WSO2's source names
 * (`tas`, `ips_incoming`, ..., `telebirrToBank`). Keys are passed through as
 * WSO2 sends them, so a source WSO2 adds shows up without a backend change.
 * WSO2 ignores `source` here and always lists every source.
 */
export async function fetchAllAdvanced(startDate: string, endDate: string): Promise<AllAdvancedResult> {
  const result = await callWso2("/wso2Dashboard/allAdvanced", { startDate, endDate, source: "all" }, "allAdvanced");
  if (!result.ok) return result;

  const raw = result.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.error(`WSO2 allAdvanced returned no data: ${result.text.slice(0, 300)}`);
    return { ok: false, status: 502, message: "WSO2 returned an invalid response" };
  }

  const data: Record<string, TransactionTotals> = {};
  for (const [source, value] of Object.entries(raw)) {
    const totals = parseTotals(value);
    if (!totals) {
      console.error(`WSO2 allAdvanced returned invalid totals for ${source}: ${JSON.stringify(value)}`);
      return { ok: false, status: 502, message: `WSO2 returned invalid totals for ${source}` };
    }
    data[source] = totals;
  }
  return { ok: true, data };
}

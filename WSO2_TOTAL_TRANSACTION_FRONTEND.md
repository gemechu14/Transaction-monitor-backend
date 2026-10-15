# Total Transaction API: Frontend Integration

Live transaction count and amount per payment source, from WSO2 Micro Integrator.

**The frontend never calls WSO2 directly.** It calls the TM backend, and the backend calls WSO2 server-side. That keeps WSO2 off the public internet, avoids CORS problems, and works around bugs in the WSO2 API (see the end of this doc).

```
Browser  ──►  TM backend  /api/dashboard/total-transaction  ──►  WSO2  https://wso2mi.coopbankoromiasc.com/wso2Dashboard/totalTransaction
```

---

## 1. Endpoint

```
GET /api/dashboard/total-transaction?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&source=<source>
```

| Param | Required | Format |
|---|---|---|
| `startDate` | yes | `YYYY-MM-DD`, inclusive |
| `endDate` | yes | `YYYY-MM-DD`, inclusive, must be on or after `startDate` |
| `source` | yes | one of the values in section 3 |

**Auth:** the user must be logged in. Send the session cookie with `credentials: "include"`, exactly like the `/api/auth/*` calls. No token handling is needed on the frontend.

**Proxy:** the frontend already forwards `/api/auth/*` and `/api/admin/*` to the backend in `next.config.ts`. Add `/api/dashboard/*` the same way:

```ts
// next.config.ts → rewrites()
{ source: "/api/dashboard/:path*", destination: `${authBackend}/api/dashboard/:path*` },
```

---

## 2. Responses

Every response uses the same envelope.

### Single source: `200`

```json
{
  "success": true,
  "message": "Total transactions fetched successfully",
  "data": {
    "source": "eeu",
    "startDate": "2026-10-01",
    "endDate": "2026-10-12",
    "totalTransactions": 5457,
    "totalAmount": 17252980.08
  }
}
```

### `source=all`: `200`

The backend adds up all 8 sources itself and also returns a per-source breakdown.

- A source that fails has `"ok": false`, is **left out of the totals**, and is listed in `failedSources`.
- **If `failedSources` is not empty, show a warning that the totals are partial.**

```json
{
  "success": true,
  "message": "Total transactions fetched successfully",
  "data": {
    "source": "all",
    "startDate": "2026-10-01",
    "endDate": "2026-10-12",
    "totalTransactions": 99630,
    "totalAmount": 1105900331.14,
    "bySource": [
      { "source": "tas", "ok": false, "status": 502, "message": "WSO2 returned an invalid response" },
      { "source": "ips_incoming", "ok": true, "totalTransactions": 89375, "totalAmount": 936246837.59 },
      { "source": "ips_push", "ok": true, "totalTransactions": 4549, "totalAmount": 137492611.36 },
      { "source": "coopapp", "ok": true, "totalTransactions": 37, "totalAmount": 78056 },
      { "source": "jica", "ok": true, "totalTransactions": 193, "totalAmount": 1155576.32 },
      { "source": "eeu", "ok": true, "totalTransactions": 5457, "totalAmount": 17252980.08 },
      { "source": "souflle", "ok": true, "totalTransactions": 19, "totalAmount": 13674269.79 },
      { "source": "hajj", "ok": true, "totalTransactions": 0, "totalAmount": 0 }
    ],
    "failedSources": ["tas"]
  }
}
```

### Errors

```json
{
  "success": false,
  "message": "Invalid or missing query parameters",
  "error": { "code": 400, "details": "startDate must be on or before endDate" }
}
```

Show `error.details` to the user.

| Status | Meaning | What to do in the UI |
|---|---|---|
| 400 | Missing or invalid `startDate`, `endDate` or `source`, or `startDate` is after `endDate` | Fix the request. This is a frontend bug or a bad date-picker value |
| 401 | Not logged in (backend session) | Same handling as other 401s: send the user to login |
| 502 | WSO2 failed or sent an invalid response (for `all`: every source failed) | Show "Couldn't load totals" and allow a retry |
| 504 | WSO2 didn't respond within 15s | Same as 502 |

A 401 here always means the user's own session expired. It never means WSO2 rejected the request.

---

## 3. Sources: dropdown values

Use these exact `value`s. The labels are suggestions.

| `value` (sent to the API) | Label |
|---|---|
| `all` | All sources |
| `tas` | TAS |
| `ips_incoming` | IPS Incoming |
| `ips_push` | IPS Push |
| `coopapp` | CoopApp |
| `jica` | JICA |
| `eeu` | EEU |
| `souflle` | Souflle (spelled this way in WSO2, don't "fix" it) |
| `hajj` | Hajj |

```ts
// src/config/wso2-sources.ts
export type Wso2ChannelSource =
  | "tas" | "ips_incoming" | "ips_push" | "coopapp"
  | "jica" | "eeu" | "souflle" | "hajj";

export type Wso2Source = Wso2ChannelSource | "all";

export const WSO2_SOURCE_LABELS: Record<Wso2Source, string> = {
  all: "All sources",
  tas: "TAS",
  ips_incoming: "IPS Incoming",
  ips_push: "IPS Push",
  coopapp: "CoopApp",
  jica: "JICA",
  eeu: "EEU",
  souflle: "Souflle",
  hajj: "Hajj",
};

export const WSO2_SOURCES = Object.keys(WSO2_SOURCE_LABELS) as Wso2Source[];
```

> **Note on the existing "Platform" dropdown:** it currently lists the mock channels (Telebirr, M-Besa, Chapa, …). Those are not real WSO2 sources. Any dropdown that feeds this API must use the list above. The mock-driven charts still filter by the old channel IDs, so switching the shared Platform dropdown to WSO2 sources will stop those charts from filtering until they get real APIs too.

---

## 4. Types

```ts
export interface TotalTransactionParams {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  source: Wso2Source;
}

export type SourceTotals =
  | { source: Wso2ChannelSource; ok: true; totalTransactions: number; totalAmount: number }
  | { source: Wso2ChannelSource; ok: false; status: number; message: string };

export interface TotalTransactionSummary {
  source: Wso2Source;
  startDate: string;
  endDate: string;
  totalTransactions: number;
  totalAmount: number;
  bySource?: SourceTotals[];             // only when source = "all"
  failedSources?: Wso2ChannelSource[];   // only when source = "all"
}
```

---

## 5. Fetch function and hook

```ts
// src/lib/api/dashboard.ts
import { AUTH_API_BASE_URL } from "@/lib/api/auth-client";
import { ApiError } from "@/lib/api/client";

export async function getTotalTransaction(params: TotalTransactionParams): Promise<TotalTransactionSummary> {
  const search = new URLSearchParams({ startDate: params.startDate, endDate: params.endDate, source: params.source });
  const url = `${AUTH_API_BASE_URL}/api/dashboard/total-transaction?${search}`;

  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new ApiError(
      body?.error?.details ?? body?.message ?? `Request failed with status ${response.status}`,
      response.status,
      url,
    );
  }
  return body.data as TotalTransactionSummary;
}
```

```ts
// src/hooks/use-total-transaction.ts
export function useTotalTransaction(params: TotalTransactionParams) {
  return useQuery({
    queryKey: ["total-transaction", params],
    queryFn: () => getTotalTransaction(params),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous, // keep old figures visible while switching source/range
  });
}
```

Usage:

```tsx
const { data, isLoading, isError, error } = useTotalTransaction({
  startDate: range.from,
  endDate: range.to,
  source, // from the dropdown
});
```

---

## 6. Display tips

- `totalAmount` is in ETB and can be over 1 billion. Use compact format on tiles (`ETB 1.1B`) and full format in tables (`ETB 1,105,900,331.14`).
- `totalTransactions` is an integer. Format it with thousands separators.
- For `all`, a breakdown table from `bySource` is useful. Show `ok: false` rows as "Unavailable".
- `hajj` often returns `0 / 0`. That's real data, not an error.

---

## 7. Known WSO2 issues (handled by the backend)

You don't need to code around these. They explain what you may see.

| Issue | Effect in the UI |
|---|---|
| `tas` always returns HTTP 500 with invalid JSON | `tas` alone gives a 502. In `all`, it shows as failed and is excluded from the totals |
| WSO2's own `source=all` returns `0 / 0` | Not used. The backend sums the sources instead |
| WSO2 returns empty values when the request sends `Accept: application/json` | The backend sends `Accept: */*`. One more reason never to call WSO2 from the browser |

When the WSO2 team fixes `tas`, it will start appearing in the totals automatically. No frontend change is needed.

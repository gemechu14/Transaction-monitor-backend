# TM Backend — Frontend Integration Guide

This backend is a headless JSON API (Next.js API routes, no pages). It has no UI of its own — this doc is for whoever builds the frontend that talks to it.

## CORS

If the frontend runs on a different origin (different port counts as different origin — e.g. frontend on `:3000`, this API on `:3001`), no backend config is needed: `src/proxy.ts` allows every origin by echoing the request's `Origin` back in `Access-Control-Allow-Origin` (a literal `*` can't be used because the requests carry cookies via `credentials: "include"`).

If the frontend is instead served from the same origin (e.g. proxied behind the same domain/reverse proxy, or via the frontend's own server-side rewrite to this backend), this doesn't apply — no CORS needed for same-origin requests.

## Auth model

- Session is a single **httpOnly cookie** (`ad_session`, JWT, 8h expiry) — not a bearer token. There is nothing for the frontend to store in `localStorage`; the browser handles the cookie automatically.
- Every `fetch` call to this API **must** include `credentials: "include"` or the cookie won't be sent/received.
- Access is gated twice: (1) an admin must have pre-approved the user's email in the local registry, (2) Active Directory must accept the password. Both must pass — there's no self-registration.
- Passwords are never stored or handled by anything except AD itself.

```js
const API_BASE = "http://localhost:3001"; // wherever this backend is deployed

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.error ?? res.statusText), { status: res.status, body });
  return body;
}
```

## Endpoints

### `POST /api/auth/login`

Request:
```json
{ "identifier": "jane.doe@coopbankoromiasc.com", "password": "..." }
```
`identifier` can be the AD email or username.

Success `200`:
```json
{
  "success": true,
  "user": { "displayName": "Jane Doe", "email": "jane.doe@...", "username": "jdoe", "role": "USER" }
}
```
Sets the `ad_session` cookie.

Errors:
| Status | Body | Meaning |
|---|---|---|
| 400 | `{"error":"Username/email and password are required"}` | missing fields |
| 401 | `{"error":"Invalid username or password"}` | wrong password, unknown email, or email not yet approved by an admin — **intentionally the same message for all three**, don't try to distinguish them in the UI |
| 429 | `{"error":"Too many attempts. Please try again later."}` | rate-limited (5 attempts / 5 min, per IP and per identifier); response has a `Retry-After` header in seconds |
| 503 | `{"error":"Active Directory is temporarily unreachable. Please try again."}` | AD unreachable — show as a transient/retry-able error, not a login failure |

### `GET /api/auth/me`

Returns the current session, or `401 {"error":"Not authenticated"}`.

Success `200`:
```json
{
  "user": {
    "userId": "cuid...",
    "email": "jane.doe@...",
    "displayName": "Jane Doe",
    "givenName": "Jane",
    "username": "jdoe",
    "distinguishedName": "CN=Jane Doe,OU=...",
    "role": "ADMIN" | "USER"
  }
}
```
Use this on app load to restore session state (e.g. in a root layout/auth provider) — there's no separate "check token" endpoint.

### `POST /api/auth/logout`

No body. Always `200 {"success": true}`, clears the cookie.

### Admin endpoints — require `role: "ADMIN"` on the session

All return `401 {"error":"Not authenticated"}` if not logged in, `403 {"error":"Forbidden"}` if logged in as a non-admin. Enforced both by proxy and per-route, so don't rely on hiding UI alone.

#### `GET /api/admin/users?search=&role=&status=`
All query params optional. `search` matches on email (substring). `role` is `ADMIN`|`USER`, `status` is `ACTIVE`|`DISABLED`.

```json
{ "users": [ { "id": "...", "email": "...", "displayName": null, "username": null, "role": "USER", "status": "ACTIVE", "lastLoginAt": null, "createdAt": "...", "updatedAt": "...", "createdBy": "admin@..." } ] }
```
Note: `displayName`/`username` are `null` until that user has logged in at least once (they're synced from AD on first successful login, not set at creation).

#### `POST /api/admin/users`
Pre-approves a new user so they're allowed to log in.
```json
{ "email": "new.user@coopbankoromiasc.com", "role": "USER" }
```
`role` optional, defaults to `USER`. Returns `201 { "user": {...} }`, or `409 {"error":"User already exists"}`.

#### `GET /api/admin/users/:id`
Returns `{ "user": {...} }` or `404 {"error":"Not found"}`.

#### `PATCH /api/admin/users/:id`
Partial update — send only the fields to change:
```json
{ "role": "ADMIN", "status": "DISABLED" }
```
Returns `{ "user": {...} }` or `404` if the id doesn't exist.

#### `DELETE /api/admin/users/:id`
**Soft-delete** — sets `status: "DISABLED"`, does not remove the row (preserves audit history). A disabled user is blocked at the login gate regardless of AD credentials. Returns `{ "user": {...} }` or `404`.

## Roles & statuses

- `role`: `ADMIN` (can manage users) | `USER`
- `status`: `ACTIVE` | `DISABLED` (disabled = cannot log in, even with correct AD password)

## Things the frontend should handle explicitly

- **429 with `Retry-After`**: back off login attempts and surface a "try again in Ns" message rather than looping.
- **503 on login**: distinct from a bad password — AD being down is a different UX case (retry banner, not "wrong password").
- **No self-service signup**: if login fails for a legitimate AD user, the likely cause is they haven't been pre-approved by an admin yet — direct them to ask an admin, don't imply their password is wrong.
- **Session expiry**: cookie expires after 8h with no refresh endpoint; on a `401` from any authenticated call, redirect to login.

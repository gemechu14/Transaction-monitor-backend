# TM Backend

Standalone authentication/authorization backend, built as a Next.js API-only app (no UI — intended to be called by a separate frontend project).

Login is hybrid: Active Directory is the only password authority (`src/lib/ldap.ts`), but a local PostgreSQL user registry (via Prisma, `prisma/schema.prisma`) gates access — only emails an admin has pre-approved can sign in, and it's where roles (`ADMIN`/`USER`) live. AD credentials never touch the local database.

## Endpoints

- `POST /api/auth/login` — `{ identifier, password }`, sets an `ad_session` HTTP-only cookie
- `POST /api/auth/logout`
- `GET /api/auth/me` — current session user
- `GET /api/admin/users` — list users (admin only; `?search=&role=&status=`)
- `POST /api/admin/users` — pre-approve a new user (admin only)
- `GET /api/admin/users/[id]`, `PATCH`, `DELETE` (disables, doesn't hard-delete) — admin only

Admin routes are gated both in `src/proxy.ts` (Next.js's middleware-equivalent) and per-route via `src/lib/authz.ts`, for defense in depth.

## First-time setup

Requires a running PostgreSQL server reachable at the `DATABASE_URL` in `.env` (defaults to a local `hormuzdb` database).

```bash
npm install
npx prisma migrate deploy   # applies existing migrations against the configured database
SEED_ADMIN_EMAIL=you@example.com npx prisma db seed   # bootstraps the first admin (bash)
$env:SEED_ADMIN_EMAIL='you@example.com'; npx prisma db seed   # PowerShell equivalent
npm run dev
```

`SEED_ADMIN_EMAIL` is only read once, at seed time — it's not a standing credential. Once at least one admin exists, use `/api/admin/users` to approve further users and assign roles.

`.env.local` holds the real AD service-account credentials (copied from the sibling `ad-login` project) — treat it accordingly and rotate `JWT_SECRET` before this goes anywhere near production; it's currently still the placeholder value.

Rate limiting on `/api/auth/login` (`src/lib/rate-limit.ts`) is in-memory, per-process — fine for a single instance, but won't coordinate across multiple instances/replicas if you scale out later.

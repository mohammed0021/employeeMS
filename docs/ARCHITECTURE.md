# Architecture — AI-Powered Employee Management System (FYP)

> Living document describing what is **built** and what is **planned**.
> Requirements: FR01–FR11. Budget: $0 (Neon free tier, OpenRouter free models,
> local ML training).

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.4.2 App Router, TypeScript strict | Route Handlers mutate, Server Components read |
| UI | Tailwind v4, shadcn/ui (**Base UI** preset), Recharts 3 | Composition prop is `render={<Link/>}`, **not** `asChild` |
| Forms | React Hook Form + Zod v4 | Mirrored client/server schemas |
| ORM | Prisma 7 (`prisma-client` generator) → `src/generated/prisma` | Adapter: `@prisma/adapter-pg` over a `pg` Pool |
| Database | Neon Postgres (free tier), pooled + direct endpoints | See §4 |
| Auth | Custom session store (no third-party IdP) | See §3 |
| AI | OpenRouter free models, server-side only | Provider abstraction + mock mode |
| ML | scikit-learn **offline**, exported to JSON, inferred in TS | No Python service at runtime |

## 2. Source map

```
src/
  proxy.ts                  coarse cookie gate (Next 16 middleware)
  app/
    (auth)/login/           sign-in page
    (dashboard)/…           one route group per module (guards in each page)
    api/<domain>/route.ts   mutations (POST/PATCH/DELETE) + list GETs
  lib/
    auth/                   permissions · guards · session · password · rate-limit
    audit/audit.ts          append-only writer + canonical action names
    services/<domain>.ts    business rules + RBAC + audit (the real boundary)
    validation/<domain>.ts  Zod schemas (server truth; mirrored in forms)
    dto.ts                  Prisma → JSON boundary (salary redaction)
    pagination.ts           shared list query + envelope
    prisma.ts · db-url.ts   client singleton · connection-string resolution
prisma/schema.prisma        17 models, 14 enums
docs/PERMISSIONS.md         role matrix (mirrors permissions.ts)
```

## 3. Auth & RBAC

- **Session**: `User` + `Session` rows, HttpOnly cookie `ems_session`. The raw
  token is random bytes; only its SHA-256 hash is stored. Sliding 7-day expiry
  (throttled writes). Account status re-checked per request.
- **Passwords**: `crypto.scrypt` with embedded salt.
- **Enforcement is server-side only** — UI hiding is never the check:
  1. `src/proxy.ts` gates unauthenticated access to protected paths.
  2. Route handlers call `requirePermission(resource, action)` (401/403 JSON).
  3. Server pages call `pagePermission(...)` (renders the 403 page).
  4. **Services re-check via `can(actor.role, …)`** — defence in depth, so a
     caller that forgets step 2 is still refused.
  5. `src/lib/dto.ts` strips fields (salaries) at the serialization boundary.
- **Permission matrix**: `src/lib/auth/permissions.ts` is the single source of
  truth; `docs/PERMISSIONS.md` mirrors it for review; tests pin it.

### Hard rules (from PERMISSIONS.md)

1. Users can never change their own `role`/`status`.
2. The last active ADMIN can never be demoted/deactivated.
3. An employee can never decide **their own** leave request (state machine +
   role check in the leave service).
4. Employees only read resources scoped to their own `employeeId`; DTOs strip
   salaries.
5. Audit logs are append-only — no update/delete code path exists anywhere.
6. Nav visibility derives from `can()` but is never the enforcement mechanism.

## 4. Data layer & Neon

- **Two endpoints**: pooled (`EMS_DATABASE_URL`, `-pooler` host) for runtime;
  direct (`EMS_DATABASE_URL_UNPOOLED`) for `prisma migrate` — PgBouncer breaks
  DDL (`prepared statement "s0" already exists`).
- **Env namespacing**: a stale machine-level `DATABASE_URL` pointed at another
  project, and neither Next.js nor `dotenv` override variables already in
  `process.env`, so it silently won. Resolution lives **once** in
  `src/lib/db-url.ts`: `EMS_DATABASE_URL` → falls back to `DATABASE_URL`, so
  Vercel/Neon (which inject the conventional name) keep working unchanged.
- **Connection**: one module-scope `pg` Pool (`max: 10`,
  `connectionTimeoutMillis: 15000` to survive scale-to-zero cold starts).
- **Money** is `Decimal(12,2)`; arithmetic uses `Prisma.Decimal` — never
  floats — and serializes as an exact string.

## 5. Request conventions

- **Mutations** → Route Handlers wrapped in `apiHandler` (Zod → 400, AppError →
  its own status, unknown → generic 500 with server-side logging).
- **Reads** → Server Components calling the service directly (no fetch-to-self).
- **Lists** → `{ items, page, pageSize, total, pages }` via `pagination.ts`;
  sort columns are checked against an allow-list before touching `orderBy`.
- **Audit** → every mutation writes `AuditLog` through `recordAudit`, which
  filters keys matching `password|token|secret|api…` from metadata.

## 6. Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Scaffold, routing, shell, permission matrix | ✅ done |
| 2 | Auth, RBAC, guards, audit, Neon provisioning, seed | ✅ done |
| 3 | Core HR: departments, employees, attendance, leave, payroll | ✅ done (backends + UIs, live-verified) |
| 4 | AI: RAG policy chatbot, feedback | ✅ built end-to-end; live answers need `OPENROUTER_API_KEY` (verified with `AI_MOCK=1` + the honest 503 path) |
| 4b | ML: attrition model (scikit-learn, offline export) | ✅ inference + dashboard done; needs Python + IBM dataset to produce `models/attrition-model.json` |
| 5 | Reports, audit UI, Playwright E2E | ✅ done (9/9 E2E) |
| 6 | GitHub + Vercel deploy | ⬜ needs repo (`gh` CLI not installed) |

Test suites (Phase 5's other half):

| Suite | Runner | Scope | Verified against |
|---|---|---|---|
| Integration | vitest (`npm test`) | 134 tests / 15 files — service layer, RBAC scoping, Decimal-exact payroll, immutability, RAG retrieval, honest AI failures | disposable schema-only Neon branch `test-db` (`TEST_DATABASE_URL`); setup hard-fails if the test host ever equals production |
| E2E | Playwright (`npm run test:e2e`) | 9 tests / 6 specs — login, logout, unauth redirect, cross-role 403s, full leave journey, chatbot honest-failure, change-password validation, Base UI Button console-cleanliness (no `nativeButton` warning anywhere; `render={<Link/>}` controls stay `role="link"`) | real `next dev` server + Chromium. Login attempts are rate-limited per IP+email (5 / 15 min, DB-backed, `src/lib/auth/rate-limit.ts`) and all specs share that budget — a blocked login surfaces as "Too many attempts" and stalls the login helper |

AI/ML configuration, deliberately three-state so nothing is ever fabricated:
`OPENROUTER_API_KEY` + `AI_MODEL` set → live calls; `AI_MOCK=1` → deterministic
stub that labels itself `mock` in `AiUsageLog`, message metadata and the UI;
neither → 503 `AI_UNAVAILABLE` with the user's message still persisted. The
attrition endpoint behaves the same way when no trained model file exists
(503 `ATTRITION_MODEL_MISSING`, zero risk rows written).

## 7. Operational commands

```bash
npm run dev            # local dev (uses .env EMS_* vars)
npm run build          # typecheck + production build
npm run db:migrate     # prisma migrate dev  (direct endpoint)
npm run db:seed        # demo data — idempotent, refuses NODE_ENV=production
npm run create-admin   # idempotent ADMIN bootstrap
node scripts/db-connectivity-test.mjs   # pooled + direct connectivity proof
npx tsc --noEmit && npm run lint && npm test   # gate (needs TEST_DATABASE_URL)
npm run test:e2e       # Playwright (needs a dev server on :3002)
```

## 8. Security posture (checklist)

- [x] No secrets in git — `.env`, `.env.*`, `.neon` ignored; `.env.example` only
- [x] Session token hashed at rest; HttpOnly/SameSite=Lax/Secure-in-prod cookie
- [x] Rate-limited login (DB-backed fixed windows)
- [x] Server-side RBAC on every route + page + service
- [x] Salary/PII redaction at the DTO boundary
- [x] Generic 500s; raw SQL/DB errors never reach clients
- [x] Audit trail append-only; sensitive keys filtered from metadata
- [x] AI key server-only — read in `src/lib/ai/provider.ts`, never `NEXT_PUBLIC_`
- [x] Every LLM call goes through one choke point (timeout, single attempt, per-user daily budget, metadata-only logging)
- [x] No fabricated AI/ML results — mock is labelled everywhere; missing key/model is an honest 503

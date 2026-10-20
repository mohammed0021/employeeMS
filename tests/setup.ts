/**
 * Vitest setup — runs once per test file, BEFORE that file imports anything
 * from `@/lib/*`.
 *
 * Why the ordering matters: `src/lib/prisma.ts` resolves its connection string
 * AT MODULE LOAD (`requireDbUrl("pooled")` reads `process.env.EMS_DATABASE_URL`
 *), so the override below has to be in place before the first import of any
 * service or of the Prisma client itself. Setup files are imported before the
 * test file, which gives us exactly that.
 *
 * Two guards make sure the integration suite can only ever touch the
 * disposable schema-only Neon branch:
 *  1. FAIL FAST when TEST_DATABASE_URL is missing — no fallback to
 *     EMS_DATABASE_URL/DATABASE_URL, because "no env" must never silently
 *     become "run the tests against the dev database".
 *  2. FAIL FAST when TEST_DATABASE_URL points at the same Postgres instance
 *     as the original EMS_DATABASE_URL — this is the "someone edited .env /
 *     deleted the override and now the tests aim at production" scenario.
 */
import "dotenv/config"; // must stay first: .env carries TEST_DATABASE_URL
import { afterAll } from "vitest";

function fail(message: string): never {
  throw new Error(`[tests] ${message}`);
}

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || testUrl.trim().length === 0) {
  fail(
    "TEST_DATABASE_URL is not set. The integration suite requires the disposable " +
      "schema-only Neon branch (TEST_DATABASE_URL=postgresql://… in .env). " +
      "Refusing to fall back to EMS_DATABASE_URL/DATABASE_URL so tests can never " +
      "write to the development/production database.",
  );
}

/**
 * Postgres instance identity, ignoring the `-pooler` (PgBouncer) suffix so a
 * pooled and an unpooled URL for the same project still compare equal.
 * `ep-frosty-boat-b4ny88tt-pooler.c-6.us-east-2.aws.neon.tech` → `ep-frosty-boat-b4ny88tt`.
 */
function instanceId(url: string, label: string): string {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return fail(`${label} is not a valid postgres URL (could not parse its host).`);
  }
  return host.split(".")[0].replace(/-pooler$/, "");
}

const testInstance = instanceId(testUrl, "TEST_DATABASE_URL");

// The guard runs against the *original* values, before the override below.
for (const name of ["EMS_DATABASE_URL", "EMS_DATABASE_URL_UNPOOLED"] as const) {
  const original = process.env[name];
  if (original && instanceId(original, name) === testInstance) {
    fail(
      `TEST_DATABASE_URL targets the same Postgres instance as ${name} ` +
        `(${new URL(original).host}). The tests must run against the disposable ` +
        "test-db branch — refusing to start so they cannot write to the real database.",
    );
  }
}

// ── The override every service read goes through ─────────────────────────────
process.env.EMS_DATABASE_URL = testUrl;
process.env.EMS_DATABASE_URL_UNPOOLED = testUrl;

// Deterministic AI: `callAi` returns the clearly-labelled stub and never hits
// the network. provider.ts reads this at import time — still before any test
// file import, so the mock branch is guaranteed.
process.env.AI_MOCK = "1";

console.log(
  `[tests] EMS_DATABASE_URL → ${instanceId(testUrl, "TEST_DATABASE_URL")} (from TEST_DATABASE_URL) · AI_MOCK=1`,
);

/**
 * Safety net only: real cleanup is per-file (see `tests/helpers.ts`
 * `runCleanups()` in each file's `afterAll`). Registered globally so a file
 * that forgot its own hook still has one — it deliberately deletes nothing.
 */
afterAll(() => {
  // no-op
});

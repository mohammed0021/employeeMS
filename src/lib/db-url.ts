/**
 * Single source of truth for resolving Postgres connection strings.
 *
 * Why the `EMS_` prefix exists:
 *
 *   This machine has a stale *User-level* `DATABASE_URL` pointing at a
 *   different Neon project (`ep-empty-field-az1nsb6q-pooler…`). Both Next.js
 *   and `dotenv` load `.env` **without overriding** variables already present
 *   in `process.env`, so that ambient value silently wins over this repo's
 *   `.env` on every local command — running migrations, seeding, or booting
 *   the app against the wrong database with no error.
 *
 *   Preferring `EMS_DATABASE_URL` (absent from the ambient environment)
 *   makes this repo's `.env` authoritative locally, while the fallback to the
 *   unprefixed `DATABASE_URL` keeps platforms that inject the conventional
 *   name — Vercel's Neon integration, Neon Functions — working with zero
 *   changes.
 *
 *   On Vercel only `DATABASE_URL` exists, so the fallback selects it. Locally
 *   both are set and the `EMS_` value wins. `.env` is gitignored; this file
 *   contains no secrets.
 *
 * NOTE: keep this module dependency-free (no Next.js / app imports) so
 * `prisma.config.ts` and standalone scripts can import it safely.
 */

/** Which of the two endpoints to resolve. */
export type DbUrlKind = "pooled" | "direct";

export interface ResolvedDbUrl {
  /** The connection string, or `undefined` when no candidate was set. */
  url: string | undefined;
  /**
   * The env var name that supplied `url`. Surfacing this is deliberate: it
   * makes "which database am I actually talking to?" answerable from logs
   * instead of a silent wrong-host connection.
   */
  source: string | undefined;
}

/**
 * Candidate env var names, in preference order.
 *
 * `direct` falls back to the pooled URL last, because schema migrations over
 * a pooled (PgBouncer) connection corrupt DDL handling — it is a last resort
 * for single-connection local dev, never the intent.
 */
const CANDIDATES: Record<DbUrlKind, readonly string[]> = {
  pooled: ["EMS_DATABASE_URL", "DATABASE_URL"],
  direct: [
    "EMS_DATABASE_URL_UNPOOLED",
    "DATABASE_URL_UNPOOLED",
    "EMS_DATABASE_URL",
    "DATABASE_URL",
  ],
};

/**
 * Resolve a connection string for `kind`.
 *
 * Reads `process.env` lazily (at call time, not module load) so that
 * `dotenv/config` and Next.js env loading can complete before resolution —
 * a top-level `const` would freeze an empty value during import hoisting.
 */
export function resolveDbUrl(kind: DbUrlKind): ResolvedDbUrl {
  for (const key of CANDIDATES[kind]) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      return { url: value, source: key };
    }
  }
  return { url: undefined, source: undefined };
}

/**
 * Resolve a connection string or throw a message that names the variables
 * actually checked. Used by code paths that cannot start without a database.
 */
export function requireDbUrl(kind: DbUrlKind): string {
  const { url } = resolveDbUrl(kind);
  if (url) return url;
  throw new Error(
    `No ${kind} database URL is set. Checked (in order): ${CANDIDATES[kind].join(
      ", ",
    )}. Copy .env.example to .env and configure it.`,
  );
}

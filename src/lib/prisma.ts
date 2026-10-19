import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Pool } from "pg";
import { requireDbUrl } from "@/lib/db-url";

// Resolves `EMS_DATABASE_URL` first (this repo's .env, immune to the stale
// machine-level DATABASE_URL) then falls back to `DATABASE_URL` for platforms
// that inject the conventional name. See src/lib/db-url.ts for the rationale.
const connectionString = requireDbUrl("pooled");

// Module-scope pool: reused across hot reloads in dev and warm invocations
// in production (avoids exhausting Neon connections on every request).
const globalForPrisma = globalThis as unknown as {
  emsPool: Pool | undefined;
  emsPrisma: PrismaClient | undefined;
};

const pool =
  globalForPrisma.emsPool ??
  new Pool({
    connectionString,
    // DATABASE_URL is the pooled (`-pooler`) endpoint, which is the correct
    // runtime target on serverless: Neon's PgBouncer multiplexes many short-
    // lived function invocations onto a small number of Postgres backends.
    max: 10,
    idleTimeoutMillis: 30_000,
    // Neon computes scale to zero when idle; a cold start can take several
    // seconds to wake (observed ~1.2-4.4s on first connect). Keep this above
    // the wake-up time so the first request after idle doesn't fail with a
    // connection timeout.
    connectionTimeoutMillis: 15_000,
  });

if (!globalForPrisma.emsPool) {
  globalForPrisma.emsPool = pool;
}

export const prisma =
  globalForPrisma.emsPrisma ??
  new PrismaClient({
    adapter: new PrismaPg(pool),
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (!globalForPrisma.emsPrisma) {
  globalForPrisma.emsPrisma = prisma;
}

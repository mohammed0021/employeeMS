import "dotenv/config";
import { defineConfig } from "prisma/config";
import { requireDbUrl } from "./src/lib/db-url";

// Runtime queries use the pooled endpoint. Migrations use the direct
// (unpooled) endpoint because pooled connections (PgBouncer) break DDL
// transaction handling — Prisma Migrate then fails with misleading errors
// like `prepared statement "s0" already exists`.
//
// resolveDbUrl prefers this repo's `EMS_*` vars (so the stale machine-level
// DATABASE_URL can't hijack migrations) and falls back to the conventional
// names for platforms that inject them. See src/lib/db-url.ts.
const migrateUrl = requireDbUrl("direct");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: migrateUrl
  }
});

import "dotenv/config";
import pg from "pg";
import { resolveDbUrl } from "../src/lib/db-url.ts";
const { Client } = pg;

async function test(label, url) {
  if (!url) {
    console.log(`SKIP ${label}: env var not set`);
    return false;
  }
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const t0 = Date.now();
  try {
    await c.connect();
    const r = await c.query(
      "SELECT current_database() AS db, current_setting('server_version') AS sv",
    );
    console.log(`OK   ${label}: db=${r.rows[0].db} server=${r.rows[0].sv} in ${Date.now() - t0}ms`);
    await c.end();
    return true;
  } catch (e) {
    console.log(`FAIL ${label}: ${e.message}`);
    try { await c.end(); } catch {}
    return false;
  }
}

// Report which env var each URL came from: a silent fallback to the wrong
// database is exactly the failure this test exists to catch.
const pooled = resolveDbUrl("pooled");
const direct = resolveDbUrl("direct");
const p = await test(`POOLED (${pooled.source ?? "unset"})`, pooled.url);
const d = await test(`DIRECT (${direct.source ?? "unset"})`, direct.url);
console.log(`RESULT pooled=${p} direct=${d}`);
process.exit(p && d ? 0 : 1);

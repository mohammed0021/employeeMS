#!/usr/bin/env node
/**
 * Performance test for the AI-Powered EMS (thesis §3.8.4, Table 3.7).
 *
 * Measures wall-clock response time for the application's critical read paths:
 * rendered pages and JSON APIs, after one warm-up pass, and reports min /
 * median / average / p95 / max per endpoint. The pass criterion from the
 * thesis is < 2–3 seconds ("standard academic website experience").
 *
 * Design notes:
 *  - Signs in ONCE and reuses the session cookie for every measurement. The
 *    login route is rate-limited (5 per IP+email per 15 min, counting
 *    successes), so hammering it would poison both the numbers and the E2E
 *    suite's shared budget.
 *  - The suite is read-only: no mutation endpoint is exercised, so running it
 *    against dev data writes nothing (not even audit rows).
 *  - Each route is warmed first, so the reported figures are steady-state,
 *    not Next.js on-demand compilation.
 *
 * Usage:
 *   node scripts/perf-test.mjs [--base http://localhost:3002] [--runs 10]
 *                              [--warmup 1] [--budget-ms 3000]
 *                              [--markdown] [--out docs/perf-report.md]
 *
 * Exit code 1 if any endpoint's median exceeds the budget.
 */
import "dotenv/config";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const BASE = flag("base", process.env.PERF_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
const RUNS = Number(flag("runs", "10"));
const WARMUP = Number(flag("warmup", "1"));
const BUDGET_MS = Number(flag("budget-ms", "3000"));
const AS_MARKDOWN = has("markdown");
const OUT = flag("out", null);

const EMAIL = flag("email", process.env.ADMIN_EMAIL);
const PASSWORD = flag("password", process.env.ADMIN_PASSWORD);

/** Pages that render through Server Components (measures SSR + DB + CSS). */
const PAGES = [
  "/login",
  "/dashboard",
  "/employees",
  "/departments",
  "/attendance",
  "/leave",
  "/payroll",
  "/chat",
  "/feedback",
  "/attrition",
  "/reports",
  "/audit",
  "/settings",
];

/** JSON APIs a logged-in user hits while working (measures service + Prisma). */
const APIS = [
  "/api/auth/me",
  "/api/employees?page=1&pageSize=25",
  "/api/departments",
  "/api/attendance",
  "/api/leave",
  "/api/payroll",
  "/api/reports/summary",
  "/api/audit?pageSize=25",
  "/api/policies",
  "/api/chat/conversations",
  "/api/attrition/signals",
  "/api/admin/users",
];

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    median: percentile(sorted, 50),
    avg: sum / sorted.length,
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    n: sorted.length,
  };
};

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")])
    .filter(Boolean)
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("login returned no session cookie");
  return cookie;
}

async function timed(url, cookie) {
  const started = performance.now();
  const res = await fetch(url, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
  });
  await res.arrayBuffer(); // consume the body — the real cost is server-side
  return { ms: performance.now() - started, status: res.status };
}

async function measure(path, cookie, label) {
  const url = `${BASE}${path}`;
  for (let i = 0; i < WARMUP; i++) await timed(url, cookie);

  const samples = [];
  let status = 0;
  for (let i = 0; i < RUNS; i++) {
    const { ms, status: s } = await timed(url, cookie);
    samples.push(ms);
    status = s;
    await new Promise((r) => setTimeout(r, 50)); // don't pipeline the server
  }
  return { label, path, status, ...stats(samples) };
}

function render(rows) {
  const ms = (n) => `${n.toFixed(0)}`;
  const table = [
    "| # | Endpoint | Type | Status | Min (ms) | Median (ms) | Avg (ms) | P95 (ms) | Max (ms) | Within 2–3 s |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r, i) =>
      `| ${i + 1} | \`${r.path}\` | ${r.type} | ${r.status} | ${ms(r.min)} | ${ms(r.median)} | ${ms(r.avg)} | ${ms(r.p95)} | ${ms(r.max)} | ${
        r.median <= BUDGET_MS ? "✅" : "❌"
      } |`,
    ),
  ].join("\n");

  const over = rows.filter((r) => r.median > BUDGET_MS);
  const slowest = rows.reduce((a, b) => (a.median > b.median ? a : b));
  const summary = [
    ``,
    `**Run:** ${new Date().toISOString()} · ${RUNS} measured request(s) per endpoint after ${WARMUP} warm-up ·`,
    `${rows.length} endpoints · threshold ${BUDGET_MS} ms.`,
    ``,
    `Slowest endpoint by median: \`${slowest.path}\` at ${slowest.median.toFixed(0)} ms. ` +
      (over.length
        ? `${over.length} endpoint(s) exceeded the budget: ${over.map((r) => `\`${r.path}\``).join(", ")}.`
        : `All endpoints met the < 2–3 s requirement.`),
  ].join("\n");

  return `${table}\n${summary}\n`;
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error("Missing credentials: set ADMIN_EMAIL / ADMIN_PASSWORD or pass --email/--password.");
    process.exit(2);
  }

  console.log(`Performance test → ${BASE} · ${RUNS} runs/endpoint · budget ${BUDGET_MS} ms`);

  const t0 = performance.now();
  const cookie = await login();
  console.log(`Signed in as ${EMAIL} in ${(performance.now() - t0).toFixed(0)} ms (1 attempt, cookie reused)\n`);

  const rows = [];
  for (const path of PAGES) {
    const type = path === "/login" ? "page" : "page (auth)";
    rows.push({ type, ...(await measure(path, cookie, path)) });
    process.stdout.write(`  ✓ ${path}\n`);
  }
  for (const path of APIS) {
    rows.push({ type: "api", ...(await measure(path, cookie, path)) });
    process.stdout.write(`  ✓ ${path}\n`);
  }

  // /login must not receive the session cookie — measure it unauthenticated.
  const anonLogin = await measure("/login", null, "/login (anonymous)");
  rows[0] = { ...anonLogin, type: "page" };

  const report = render(rows);
  if (AS_MARKDOWN || OUT) console.log("\n" + report);
  else console.log("\nPass --markdown to print the thesis table.");

  if (OUT) {
    const { writeFile } = await import("node:fs/promises");
    const header = `# Performance test — AI-Powered Employee Management System\n\nSource: \`scripts/perf-test.mjs\` (thesis §3.8.4).\n\n`;
    await writeFile(OUT, header + report, "utf8");
    console.log(`Wrote ${OUT}`);
  }

  const failures = rows.filter((r) => r.median > BUDGET_MS);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(2);
});

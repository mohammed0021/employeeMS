#!/usr/bin/env node
/**
 * Capture thesis screenshots (Chapter 4 — Implementation) of the AI-Powered EMS.
 *
 * One sign-in per role, then a full-page PNG per screen, named in reading order
 * so the figures can be inserted into the thesis as-is:
 *
 *   docs/screenshots/NN-<role>-<screen>.png
 *
 * Usage:
 *   node scripts/capture-screenshots.mjs [--base http://localhost:3002]
 *                                        [--out docs/screenshots]
 *                                        [--roles admin,hr,employee]
 *                                        [--width 1440] [--height 900]
 *
 * Sign-ins are deliberately minimal: the login route allows 5 attempts per
 * IP+email per 15 minutes counting successes, and the E2E suite shares that
 * budget. This script signs in exactly once per role and reuses the session.
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASE = flag("base", "http://localhost:3002").replace(/\/$/, "");
const OUT = flag("out", "docs/screenshots");
const WIDTH = Number(flag("width", "1440"));
const HEIGHT = Number(flag("height", "900"));

const CREDENTIALS = {
  admin: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  hr: { email: "hr@example.com", password: "DemoPass!2026#Strong" },
  employee: { email: "employee@example.com", password: "DemoPass!2026#Strong" },
};

/** Screens per role — [file stem, path, optional extra wait selector]. */
const SCREENS = {
  admin: [
    ["login", "/login"],
    ["dashboard", "/dashboard"],
    ["employees", "/employees"],
    ["departments", "/departments"],
    ["attendance", "/attendance"],
    ["leave", "/leave"],
    ["payroll", "/payroll"],
    ["chat", "/chat"],
    ["feedback", "/feedback"],
    ["attrition", "/attrition"],
    ["reports", "/reports"],
    ["audit", "/audit"],
    ["settings", "/settings"],
  ],
  hr: [
    ["leave-approvals", "/leave/approvals"],
    ["attendance-hr", "/attendance"],
  ],
  employee: [
    ["dashboard-employee", "/dashboard"],
    ["leave-employee", "/leave"],
    ["chat-employee", "/chat"],
  ],
};

const ORDER = [
  "login",
  "dashboard",
  "employees",
  "departments",
  "attendance",
  "leave",
  "payroll",
  "chat",
  "feedback",
  "attrition",
  "reports",
  "audit",
  "settings",
  "leave-approvals",
  "attendance-hr",
  "dashboard-employee",
  "leave-employee",
  "chat-employee",
];

const slug = (s) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

async function signIn(page, role) {
  const creds = CREDENTIALS[role];
  if (!creds?.email || !creds?.password) throw new Error(`missing credentials for ${role}`);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  return page;
}

async function main() {
  const roles = flag("roles", "admin,hr,employee").split(",").map((r) => r.trim()).filter(Boolean);
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const manifest = [];

  try {
    for (const role of roles) {
      const context = await browser.newContext({
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: 2, // crisp figures for Word/LaTeX
        colorScheme: "light",
      });
      console.log(`\n▶ ${role}`);
      const screens = SCREENS[role] ?? [];
      const page = await context.newPage();

      // The sign-in screen must be captured anonymously, before authenticating.
      const loginScreen = screens.find(([name]) => name === "login");
      if (loginScreen) {
        const [name, route] = loginScreen;
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => {});
        await page.waitForTimeout(700);
        const idx = String(ORDER.indexOf(name) + 1).padStart(2, "0");
        const file = path.join(OUT, `${idx}-${slug(role)}-${slug(name)}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`  ✓ ${file}  (${route})`);
        manifest.push({ role, name, route, file });
      }

      await signIn(page, role);
      await page.waitForTimeout(700); // let charts/skeletons settle

      for (const [name, route] of screens) {
        if (name === "login") continue; // captured anonymously above
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => {});
        await page.waitForTimeout(900);

        const idx = String(ORDER.indexOf(name) + 1).padStart(2, "0");
        const file = path.join(OUT, `${idx}-${slug(role)}-${slug(name)}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`  ✓ ${file}  (${route})`);
        manifest.push({ role, name, route, file });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const md = [
    `# Chapter 4 figures — UI screenshots`,
    ``,
    `Captured from the production build (\`next build\` + \`next start\`) on`,
    `${new Date().toISOString()} at ${WIDTH}×${HEIGHT} @2x, full-page.`,
    ``,
    `Source: \`scripts/capture-screenshots.mjs\`.`,
    ``,
    `| Figure | Role | Screen | Route | File |`,
    `|---|---|---|---|---|`,
    ...manifest.map(
      (m, i) =>
        `| Figure 4.${i + 1} | ${m.role} | ${slug(m.name)} | \`${m.route}\` | \`${path.basename(m.file)}\` |`,
    ),
    ``,
  ].join("\n");

  await writeFile(path.join(OUT, "README.md"), md, "utf8");
  console.log(`\nWrote ${path.join(OUT, "README.md")} (${manifest.length} figures)`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(1);
});

/**
 * Demo seed — Phase 3 (Core HR) data.
 *
 * Usage:  npm run db:seed
 *
 * Design notes:
 *  - IDEMPOTENT: every write is an upsert keyed on a natural unique key, so
 *    re-running never duplicates rows (attendance has a DB @@unique on
 *    employeeId+date; payroll on employeeId+month+year).
 *  - REFUSES to run against production (NODE_ENV=production).
 *  - Uses direct Prisma writes rather than the domain services: services
 *    require an authenticated Actor and audit every change, which would
 *    pollute the audit trail with seeded rows.
 *  - Connection resolves EMS_DATABASE_URL first (see src/lib/db-url.ts) so a
 *    stale machine-level DATABASE_URL can't redirect the seed.
 */
import "dotenv/config";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hashPassword } from "../src/lib/auth/password";
import { requireDbUrl } from "../src/lib/db-url";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: requireDbUrl("pooled"),
  max: 2,
  connectionTimeoutMillis: 15_000,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Date at UTC midnight — required for `@db.Date` columns to avoid TZ drift. */
function utcDay(daysAgo = 0, base = new Date()): Date {
  const d = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) -
      daysAgo * 86_400_000,
  );
  return d;
}

/** `YYYY-MM-DD` for a fixed calendar date. */
function day(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

const DEPARTMENTS = [
  { name: "Engineering", description: "Designs, builds and maintains the product." },
  { name: "Human Resources", description: "Hiring, policy, payroll and employee relations." },
  { name: "Finance", description: "Budgeting, reporting and payments." },
  { name: "Sales", description: "Pipeline, accounts and revenue." },
  { name: "Marketing", description: "Brand, demand generation and communications." },
  { name: "Operations", description: "Facilities, logistics and internal tooling." },
] as const;

const FIRST_NAMES = [
  "Ayesha", "Bilal", "Carmen", "Daniyal", "Elena", "Farid",
  "Grace", "Hassan", "Iman", "Jonas", "Kiara", "Lucas",
];
const LAST_NAMES = [
  "Khan", "Malik", "Ortiz", "Rahman", "Silva", "Tran",
  "Ueda", "Vargas", "Wright", "Yilmaz", "Zhang", "Novak",
];

type SeedEmployee = {
  index: number;
  code: string;
  departmentName: string;
  position: string;
  salary: string;
  join: Date;
};

const EMPLOYEES: SeedEmployee[] = [
  { index: 0, code: "EMP-001", departmentName: "Engineering", position: "Senior Software Engineer", salary: "95000.00", join: day(2022, 3, 14) },
  { index: 1, code: "EMP-002", departmentName: "Engineering", position: "Software Engineer", salary: "72000.00", join: day(2023, 7, 1) },
  { index: 2, code: "EMP-003", departmentName: "Engineering", position: "QA Engineer", salary: "64000.00", join: day(2024, 1, 8) },
  { index: 3, code: "EMP-004", departmentName: "Human Resources", position: "HR Manager", salary: "81000.00", join: day(2021, 9, 20) },
  { index: 4, code: "EMP-005", departmentName: "Human Resources", position: "Recruiter", salary: "58000.00", join: day(2024, 5, 6) },
  { index: 5, code: "EMP-006", departmentName: "Finance", position: "Financial Analyst", salary: "70000.00", join: day(2023, 2, 13) },
  { index: 6, code: "EMP-007", departmentName: "Finance", position: "Accountant", salary: "62000.00", join: day(2022, 11, 2) },
  { index: 7, code: "EMP-008", departmentName: "Sales", position: "Account Executive", salary: "68000.00", join: day(2023, 4, 17) },
  { index: 8, code: "EMP-009", departmentName: "Sales", position: "Sales Development Rep", salary: "52000.00", join: day(2025, 2, 3) },
  { index: 9, code: "EMP-010", departmentName: "Marketing", position: "Marketing Specialist", salary: "60000.00", join: day(2024, 8, 19) },
  { index: 10, code: "EMP-011", departmentName: "Operations", position: "Operations Lead", salary: "75000.00", join: day(2021, 6, 7) },
  { index: 11, code: "EMP-012", departmentName: "Operations", position: "Office Coordinator", salary: "48000.00", join: day(2025, 6, 10) },
];

/** Demo login accounts (dev only — printed at the end). */
const USERS = [
  { email: "hr@example.com", role: "HR" as const, employeeCode: "EMP-004" },
  { email: "employee@example.com", role: "EMPLOYEE" as const, employeeCode: "EMP-001" },
  { email: "employee2@example.com", role: "EMPLOYEE" as const, employeeCode: "EMP-009" },
];

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "DemoPass!2026#Strong";

async function main() {
  const summary: string[] = [];

  // ── Departments ───────────────────────────────────────────────────────────
  const departmentIds = new Map<string, string>();
  for (const dept of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { name: dept.name },
      update: { description: dept.description },
      create: { name: dept.name, description: dept.description },
    });
    departmentIds.set(dept.name, row.id);
  }
  summary.push(`${DEPARTMENTS.length} departments`);

  // ── Employees ─────────────────────────────────────────────────────────────
  const employeeIds = new Map<string, string>();
  for (const emp of EMPLOYEES) {
    const firstName = FIRST_NAMES[emp.index % FIRST_NAMES.length];
    const lastName = LAST_NAMES[emp.index % LAST_NAMES.length];
    const email = `${emp.code.toLowerCase()}@example.com`;
    const departmentId = departmentIds.get(emp.departmentName);
    if (!departmentId) throw new Error(`Unknown department ${emp.departmentName}`);

    const row = await prisma.employee.upsert({
      where: { employeeCode: emp.code },
      update: {
        firstName,
        lastName,
        email,
        position: emp.position,
        salary: emp.salary,
        joinDate: emp.join,
        departmentId,
        status: "ACTIVE",
      },
      create: {
        employeeCode: emp.code,
        firstName,
        lastName,
        email,
        position: emp.position,
        salary: emp.salary,
        joinDate: emp.join,
        departmentId,
        status: "ACTIVE",
      },
    });
    employeeIds.set(emp.code, row.id);
  }
  summary.push(`${EMPLOYEES.length} employees`);

  // ── Login accounts ────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const user of USERS) {
    const employeeId = employeeIds.get(user.employeeCode);
    if (!employeeId) throw new Error(`Unknown employee ${user.employeeCode}`);
    await prisma.user.upsert({
      where: { email: user.email },
      update: { role: user.role, status: "ACTIVE", employeeId, passwordHash },
      create: { email: user.email, role: user.role, status: "ACTIVE", employeeId, passwordHash },
    });
  }
  summary.push(`${USERS.length} login accounts`);

  // ── Attendance: last 12 days, weekdays only ───────────────────────────────
  let attendanceCount = 0;
  const attendees = EMPLOYEES.slice(0, 8);
  for (let daysAgo = 12; daysAgo >= 1; daysAgo--) {
    const date = utcDay(daysAgo);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue; // skip weekends

    for (const [i, emp] of attendees.entries()) {
      const employeeId = employeeIds.get(emp.code);
      if (!employeeId) continue;

      // Deterministic mix: one absent, one remote, rest present.
      const status = i === 6 ? "ABSENT" : i === 3 ? "REMOTE" : "PRESENT";
      const checkIn =
        status === "ABSENT"
          ? null
          : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 8 + (i % 3), 45));
      const checkOut =
        status === "ABSENT"
          ? null
          : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 17, 15));

      await prisma.attendance.upsert({
        where: { employeeId_date: { employeeId, date } },
        update: { status, checkIn, checkOut },
        create: {
          employeeId,
          date,
          status,
          checkIn,
          checkOut,
          note: status === "REMOTE" ? "Working from home" : null,
        },
      });
      attendanceCount++;
    }
  }
  summary.push(`${attendanceCount} attendance records`);

  // ── Leave requests (one per status) ───────────────────────────────────────
  const employee001 = employeeIds.get("EMP-001");
  const employee009 = employeeIds.get("EMP-009");
  const admin = await prisma.user.findUnique({ where: { email: "admin@example.com" } });
  if (!employee001 || !employee009) throw new Error("Seed employees missing");

  const leaveSpecs = [
    { employeeId: employee001, start: utcDay(20), end: utcDay(18), type: "ANNUAL" as const, status: "APPROVED" as const, reason: "Family trip" },
    { employeeId: employee001, start: utcDay(5), end: utcDay(5), type: "SICK" as const, status: "PENDING" as const, reason: "Flu — resting for one day" },
    { employeeId: employee009, start: utcDay(-10), end: utcDay(-6), type: "ANNUAL" as const, status: "PENDING" as const, reason: "Planned holiday next month" },
    { employeeId: employee009, start: utcDay(30), end: utcDay(29), type: "UNPAID" as const, status: "REJECTED" as const, reason: "Personal errand during peak week" },
    { employeeId: employee001, start: utcDay(45), end: utcDay(44), type: "OTHER" as const, status: "CANCELLED" as const, reason: "No longer needed" },
  ];

  let leaveCount = 0;
  for (const spec of leaveSpecs) {
    const existing = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: spec.employeeId,
        startDate: spec.start,
        type: spec.type,
        reason: spec.reason,
      },
    });
    // Count processed specs (not just creations) so the summary matches the
    // other counters, which also report dataset size on a re-run.
    if (existing) {
      leaveCount++;
      continue;
    }

    const decided = spec.status !== "PENDING";
    await prisma.leaveRequest.create({
      data: {
        employeeId: spec.employeeId,
        startDate: spec.start,
        endDate: spec.end,
        type: spec.type,
        reason: spec.reason,
        status: spec.status,
        decisionReason: decided ? (spec.status === "REJECTED" ? "Coverage required" : "Approved by HR") : null,
        decidedById: decided ? admin?.id ?? null : null,
        decidedAt: decided ? new Date() : null,
        cancelledAt: spec.status === "CANCELLED" ? new Date() : null,
      },
    });
    leaveCount++;
  }
  summary.push(`${leaveCount} leave requests`);

  // ── Payroll: last month FINAL, current month DRAFT ────────────────────────
  const now = new Date();
  const curMonth = now.getUTCMonth() + 1;
  const curYear = now.getUTCFullYear();
  const prevDate = new Date(Date.UTC(curYear, curMonth - 2, 1));
  const prevMonth = prevDate.getUTCMonth() + 1;
  const prevYear = prevDate.getUTCFullYear();

  let payrollCount = 0;
  for (const emp of EMPLOYEES) {
    const employeeId = employeeIds.get(emp.code);
    if (!employeeId) continue;

    for (const period of [
      { month: prevMonth, year: prevYear, status: "FINAL" as const, bonus: "0.00", deduction: "0.00" },
      { month: curMonth, year: curYear, status: "DRAFT" as const, bonus: emp.index % 4 === 0 ? "1500.00" : "0.00", deduction: "0.00" },
    ]) {
      const base = new Prisma.Decimal(emp.salary);
      const gross = base.plus(period.bonus);
      const net = gross.minus(period.deduction);
      const data = {
        baseSalary: base,
        bonus: period.bonus,
        deduction: period.deduction,
        grossPay: gross,
        netPay: net,
        status: period.status,
        finalizedById: period.status === "FINAL" ? admin?.id ?? null : null,
        finalizedAt: period.status === "FINAL" ? new Date() : null,
      };

      await prisma.payrollRecord.upsert({
        where: { employeeId_month_year: { employeeId, month: period.month, year: period.year } },
        // FINAL rows are immutable by design — only recompute while DRAFT.
        update: period.status === "DRAFT" ? data : {},
        create: { employeeId, month: period.month, year: period.year, ...data },
      });
      payrollCount++;
    }
  }
  summary.push(`${payrollCount} payroll records`);

  console.log("Seed complete:");
  for (const line of summary) console.log(`  • ${line}`);
  console.log("\nDemo logins (password shown for local development only):");
  console.log(`  admin@example.com      ADMIN   ${process.env.ADMIN_PASSWORD ? "(set by create-admin)" : "(run npm run create-admin)"}`);
  for (const user of USERS) console.log(`  ${user.email.padEnd(22)} ${user.role.padEnd(7)} ${DEMO_PASSWORD}`);
  console.log("\nThese accounts exist only in development — never seed production.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  });

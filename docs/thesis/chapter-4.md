# CHAPTER FOUR

## 4.1 SYSTEM IMPLEMENTATION

This chapter describes how the AI-Powered Employee Management System described in Chapter 3 was actually built. It walks through the three architectural layers introduced in Section 3.4 — presentation, application, and data — and then details the implementation of the three AI-assisted modules: the retrieval-based HR chatbot, the AI-assisted performance feedback generator, and the predictive attrition analytics module. Every figure in this chapter was captured from the running production build of the system, and every number quoted is produced by the system's own counting queries rather than estimated.

The system was implemented across the six development phases listed in Table 3.2. All phases from requirements gathering through testing and optimisation (Phases 1–5) were completed; the deployment phase (Phase 6) is discussed in the limitations section of Chapter 5.

### 4.1.1 Development environment

The system was developed in Visual Studio Code using TypeScript in strict mode, which makes the compiler reject whole classes of defects (for example, accidentally passing a string where a number is expected) before the code ever runs. The complete implementation comprises approximately 21,800 lines of TypeScript across 147 hand-written source files, including 35 API route handlers, 17 database tables, and 13 primary application screens. Table 4.1 summarises the final implementation inventory.

**Table 4.1 Implementation inventory of the AI-Powered EMS**

| Component | Count | Notes |
|---|---|---|
| API route handlers | 35 | REST-style JSON endpoints under `/api` |
| Database tables (Prisma models) | 17 | Including 14 enumerated types for constrained values |
| Application pages (primary screens) | 13 | Login, dashboard, employees, departments, attendance, leave, payroll, chat, feedback, attrition, reports, audit, settings (22 `page.tsx` files including detail/edit sub-pages) |
| Application services | 12 | One module per business domain (employees, attendance, leave, payroll, …) plus a shared actor helper |
| Source files (excluding generated code) | 147 | ≈ 21,800 lines of TypeScript |
| Automated tests | 134 | Unit + integration; plus 9 end-to-end browser tests |

### 4.1.2 Source organisation

The codebase follows the Next.js App Router convention in which the file tree mirrors the URL tree. Server-side code is grouped under `src/lib` in clearly separated subdirectories: `auth` (sessions, password hashing, the permission matrix, rate limiting), `services` (one module per business domain containing all queries and business rules), `validation` (Zod schemas shared between client forms and server routes), `ai` (the single gateway to the language-model provider and the policy retriever), and `ml` (offline model inference). API route handlers under `src/app/api` are deliberately thin: they parse input, call exactly one service function, and serialise the result. All business rules — including permission checks and row-level scoping — live in the services, which means the same rules protect data regardless of whether the caller is a web page, the dashboard, or an external API client.

---

## 4.2 PRESENTATION LAYER IMPLEMENTATION

The presentation layer was implemented with Next.js Server Components, Tailwind CSS, and the shadcn/ui component library. Pages fetch their data on the server and send only rendered HTML to the browser, so the first meaningful paint does not wait for a sequence of client-side API calls.

### 4.2.1 Authentication and session handling

The sign-in page (Figure 4.1) validates input with the same Zod schema on the client and on the server, so a user receives instant feedback for malformed input while the server remains the final authority. Passwords are hashed with the scrypt key-derivation function from the Node.js standard library using the OWASP-recommended cost parameter N = 2^15; no password is ever stored, logged, or transmitted in readable form. Successful sign-in creates a server-side session record and returns an HTTP-only cookie that browser-side script cannot read, which structurally blocks token theft through cross-site scripting.

**Figure 4.1 Sign-in page (`/login`)** — `01-admin-login.png`

Failed sign-in attempts return the same generic error whether the email exists or not, so the system cannot be used to discover which addresses belong to the organisation. To slow brute-force attacks, the login endpoint enforces a fixed-window rate limit of five attempts per IP address and email combination per fifteen minutes, counted in the database so the limit survives server restarts.

### 4.2.2 Role-based dashboards

The dashboard (Figures 4.2 and 4.16) is assembled per role at request time from the same aggregates that back the reports module. Administrators and HR staff see organisation-wide figures — headcount by status and department, attendance totals and attendance rate, pending leave, payroll totals, and the attrition risk split — while employees see only their own attendance, leave, and payroll summary (Figure 4.16). The distinction is not cosmetic: the employee variant calls a self-scoped service function that restricts every query to the employee identifier taken from the session, so an employee cannot obtain another person's figures by manipulating the interface.

**Figure 4.2 Administrator dashboard with live aggregates (`/dashboard`)** — `02-admin-dashboard.png`

Each dashboard card prints the date window behind its numbers ("last 30 days"), and every figure is read from a database aggregation at request time; the interface contains no demonstration or placeholder values. A regression test asserts that the dashboard never displays the placeholder markers that existed in the early prototype.

**Figure 4.16 Employee dashboard — self-scoped view (`/dashboard`)** — `16-employee-dashboard-employee.png`

### 4.2.3 Employee, department, and attendance management

The employee list (Figure 4.3) implements FR02 with paginated, filterable search backed by indexed database queries; creating or editing an employee uses an equivalent validated form with the same React Hook Form and Zod validation mirrored on the server. Departments (Figure 4.4) associate employees with organisational units per FR03, and the attendance register (Figure 4.5, with the HR working view in Figure 4.15) records dated presence status per FR04.

**Figure 4.3 Employee list with pagination and search (`/employees`)** — `03-admin-employees.png`

**Figure 4.4 Department management (`/departments`)** — `04-admin-departments.png`

**Figure 4.5 Attendance register (`/attendance`)** — `05-admin-attendance.png`

**Figure 4.15 HR attendance working view (`/attendance`)** — `15-hr-attendance-hr.png`

### 4.2.4 Leave workflow

Leave management (FR05) was implemented as a state machine over four statuses — Requested, Approved, Rejected, Cancelled. An employee submits a request from their leave page (Figure 4.17); the HR approvals queue (Figure 4.14) lists pending requests with an approval action and a rejection dialog that refuses to submit an empty reason, enforcing the rule that every rejection must carry a justification.

**Figure 4.14 HR leave approvals queue (`/leave/approvals`)** — `14-hr-leave-approvals.png`

**Figure 4.17 Employee leave requests (`/leave`)** — `17-employee-leave-employee.png`

Every status transition runs inside a single database transaction together with an audit-log write, so it is impossible for an approval to succeed without its audit record.

### 4.2.5 Payroll and payslips

Payroll (FR06) is computed from base salary plus bonuses minus deductions. Monetary amounts are handled as exact decimal types end to end — from the database column through the service layer to the JSON response — and are never converted to floating-point numbers, so a payslip total cannot drift by a fraction of a cent through rounding. The payroll page (Figure 4.7) lists generated records per period, and each payslip page presents the breakdown for one employee.

**Figure 4.7 Payroll records and payslip generation (`/payroll`)** — `07-admin-payroll.png`

### 4.2.6 Reports, audit trail, and settings

The reports page (Figure 4.11) presents the organisation-wide summary computed by the reporting service with CSV export for headcount, attendance, leave, and payroll. The audit page (Figure 4.12) renders the append-only event trail: each row shows the acting user, action, entity, outcome, and timestamp. The audit table has no update or delete path anywhere in the codebase — the only writer is the audit-recording function used by every mutating service — because an audit trail its own administrators can edit stops being evidence. The settings page (Figure 4.13) allows any signed-in user to change their own password, with the current password required.

**Figure 4.11 Reports with summary statistics (`/reports`)** — `11-admin-reports.png`

**Figure 4.12 Audit trail (`/audit`)** — `12-admin-audit.png`

**Figure 4.13 Account settings and password change (`/settings`)** — `13-admin-settings.png`

### 4.2.7 Administrator user management

The administrator's user-management screen creates login accounts, assigns roles (Administrator, HR, Employee) per FR01, and activates or deactivates accounts. It is reachable only by the Administrator role — the menu itself is not rendered for other roles, and both the page and its API re-check the permission server-side; the end-to-end RBAC suite in Chapter 5 asserts that an employee who requests the screen receives the 403 page.

---

## 4.3 APPLICATION LAYER IMPLEMENTATION

The application layer implements FR01–FR11 as 35 API route handlers over 12 service modules. This section describes the cross-cutting mechanisms: input validation, the permission system, auditing, and the two AI-assisted generation features.

### 4.3.1 Input validation

Every route parses its input through a Zod schema before any database work begins. Unknown fields are stripped rather than trusted, strings are trimmed and length-bounded, numeric ranges are enforced (for example, pagination page sizes are capped), and dates must fall within sane bounds. A malformed request therefore receives a 400-level response with a precise message and never reaches a query builder.

### 4.3.2 Permission enforcement

The permission matrix of Chapter 3 is implemented as a single declarative table mapping each role to the actions it may perform on each resource (Table 4.2). Both API handlers and rendered pages consult this one table, so there is exactly one place to audit when asking "who can do what".

**Table 4.2 Extract from the implemented permission matrix**

| Resource | Administrator | HR | Employee |
|---|---|---|---|
| Employees | create, read, update, delete | create, read, update | read (own only) |
| Attendance | full | full | read (own only) |
| Leave | full | full (incl. approvals) | create, read (own), cancel (own) |
| Payroll | full | full | read (own) |
| AI feedback drafts | full | create, approve | — |
| Attrition analytics | create, read, update | create, read, update | — |
| Reports | read, export | read, export | read (own only) |
| Audit trail | read | — | — |
| User administration | full | — | — |

Where a resource supports "own" access, the restriction is applied inside the service layer using the employee identifier from the session — never by trusting an identifier supplied by the browser. The end-to-end tests in Chapter 5 verify that an employee who requests the user-administration page receives the 403 page and that the corresponding API returns 403, not merely that the link is hidden.

### 4.3.3 Auditing (FR11)

Every mutating service function writes an audit entry recording the acting user, action, entity, outcome, and timestamp. Before writing, the audit recorder strips any value whose key looks like a password, token, or secret, so credentials can never enter the audit trail even if a future developer passes them by mistake. Failed authorisation attempts are recorded as well, which makes the trail useful for detecting probing, not only for reviewing changes.

### 4.3.4 HR policy chatbot (FR07)

The chatbot is implemented as retrieval-augmented generation over the organisation's own uploaded policy documents. Policy uploads are chunked and indexed with PostgreSQL full-text search — a built-in capability of the database already in use, which avoided introducing a separate vector database and the consistency problems of synchronising one. Before every answer, the retriever extracts the policy passages most similar to the question and places them in the model's prompt; the model is instructed to answer only from those passages.

The chat interface (Figures 4.8 and 4.18) follows one overriding rule from the non-functional requirements of Chapter 3: the system must never invent an answer. When no policy passage matches a question, the assistant says so explicitly. When the language-model provider is not configured, sending a message fails inline with a clear notice and the conversation remains intact — an end-to-end test asserts that no fabricated reply ever appears in this situation.

**Figure 4.8 HR policy chatbot (`/chat`)** — `08-admin-chat.png`

**Figure 4.18 Employee chatbot view (`/chat`)** — `18-employee-chat-employee.png`

All model calls pass through a single gateway module that enforces a request timeout, a single attempt per request (free-tier quotas are never hammered by retries), a per-user daily budget, and a usage log recording timing and token counts — metadata only, never the text of prompts or answers, so policy content cannot leak through the AI usage log.

### 4.3.5 AI-assisted performance feedback (FR08)

The feedback module drafts evaluation summaries from an employee's own recorded indicators — attendance rate, leave usage, and related figures — through the same single AI gateway. Crucially, a draft is never published automatically: it is stored with status "draft", clearly labelled as machine-generated in the interface (Figure 4.9), and requires a human reviewer to approve it before it becomes the employee's official feedback. This implements the accuracy requirement of Chapter 3 directly in the workflow: AI output assists, a person decides.

**Figure 4.9 Performance feedback drafts (`/feedback`)** — `09-admin-feedback.png`

### 4.3.6 Attrition analytics (FR09)

The attrition module stores per-employee indicators (overtime, satisfaction, time since last promotion, and related fields) and exposes a dashboard of risk signals (Figure 4.10). The prediction itself is produced by a logistic-regression model trained offline with scikit-learn on historical data and exported to a JSON file of coefficients; the web application only applies those coefficients in TypeScript at run time. This design keeps Python completely out of the deployed system — there is no model server to host, secure, or keep awake — while the training remains reproducible from a documented script.

**Figure 4.10 Attrition risk dashboard (`/attrition`)** — `10-admin-attrition.png`

The system refuses to guess when the model file is absent: the run endpoint responds with an explicit "model not trained" notice rather than fabricating risk scores. The dashboard likewise displays an honest "no signals yet" state until a real model has produced them.

---

## 4.4 DATA LAYER IMPLEMENTATION

The data layer was implemented with Prisma over a PostgreSQL database hosted on Neon's free tier, using a pooled connection for ordinary traffic and a direct connection for transactional work. The schema contains 17 tables; the core entities and their relationships are the ones designed in Section 3.6, extended by supporting tables for sessions, rate limiting, policy documents, AI usage logging, and the audit trail.

Three implementation decisions are worth noting. First, foreign keys carry explicit deletion rules — an employee record referenced by attendance rows cannot be hard-deleted but is instead marked inactive, which prevents accidental destruction of historical data (FR11 and the reliability requirement). Second, constrained values (roles, statuses, leave types, risk categories) are implemented as database-level enumerations, so an invalid value is rejected by the database itself rather than only by application code. Third, a raw SQL migration adds a functional index on the policy text column that backs the chatbot's full-text retrieval, which is what keeps policy search responsive as documents grow.

Database schema changes are managed through versioned migration files, so any state of the schema can be reproduced exactly — a requirement both for the team's own debugging and for the auditability expected of a system handling payroll data.

---

## 4.5 CHAPTER SUMMARY

This chapter has described the implementation of the AI-Powered Employee Management System across its three layers. The presentation layer delivers role-specific interfaces built from server-rendered components with no placeholder data; the application layer enforces validation, a single declarative permission matrix, and append-only auditing around every business operation; and the data layer persists 17 tables with database-enforced constraints. The three AI modules — the retrieval-based chatbot, the feedback drafter, and the attrition predictor — were all implemented under one rule: the machine assists, the interface labels its output, a person decides, and an honest failure is always preferred to an invented answer. Chapter 5 evaluates the delivered system against the testing strategy defined in Section 3.8.

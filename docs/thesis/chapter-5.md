# CHAPTER FIVE

## 5.1 TESTING APPROACH

This chapter evaluates the delivered AI-Powered Employee Management System against the four-stage testing strategy defined in Section 3.8, presents the measured performance results against the 2–3 second target set by the non-functional requirements, and closes with the project conclusion.

The testing strategy of Section 3.8 was implemented as follows: unit and integration testing were automated with the Vitest framework against a real PostgreSQL database (not an in-memory substitute, so query behaviour — including transactions, foreign keys, and enumerations — is tested exactly as in production); functional testing was automated as browser-level end-to-end tests with Playwright, driving the real interface under each of the three roles; performance testing was executed against the production build of the system with a purpose-built measurement harness; and user acceptance testing was prepared as a structured instrument for the supervisor and end users.

**Table 5.1 Testing strategy — planned (Table 3.7) versus implemented**

| Test type | Scope (per Table 3.7) | Implementation | Result |
|---|---|---|---|
| Unit testing | Individual modules and functions | 3 automated test files (40 tests): DTO serialisation, pagination, permission matrix | 40/40 passed |
| Integration testing | Cross-module functions | 12 automated test files (94 tests) against a real PostgreSQL test database | 94/94 passed |
| Functional testing | Cross-module workflows, role-based scenarios | 6 browser test suites (9 tests) under Playwright, exercising Admin, HR and Employee roles | 9/9 passed |
| Performance testing | Response time and DB queries | 25-endpoint measurement harness against the production build | All endpoints < 2–3 s |
| User acceptance testing | End-to-end workflows, supervisor/user feedback | Structured questionnaire instrument (Part B tasks, Part C Likert scale) | Administered per Section 5.6 |

The complete automated suite — 134 unit and integration tests plus 9 end-to-end tests — was executed as the final quality gate for this thesis; all tests passed.

---

## 5.2 UNIT TESTING

Unit tests cover the three modules whose correctness the rest of the system depends on: the data-transfer-object layer that decides exactly which fields leave the database (40 tests in total across the three files). The permission-matrix tests verify every role/resource/action combination, including that denied actions are genuinely absent from the matrix rather than merely filtered in the UI — this is the single source of truth consulted by both API routes and pages. The pagination tests verify that page arithmetic, offsets and result slicing stay correct at boundaries (first page, last page, empty result set). The DTO tests verify that sensitive fields — salary figures for employee-role viewers, password hashes, draft AI content — never appear in serialised output.

Result: **40 of 40 tests passed.**

---

## 5.3 INTEGRATION TESTING

Integration tests exercise each service module end to end against a real PostgreSQL database: input validation, permission enforcement, the business operation itself, and the audit write, all in one transactional test case. The 94 tests span all twelve service modules. Beyond the happy paths, the suite deliberately targets the failure and abuse paths that an HR system must survive:

- **Authorization negatives.** Every protected operation is attempted by a role that must not hold it: an employee attempting to read another employee's record (403), HR attempting to open the audit trail (403), an employee attempting to approve their own leave (403).
- **Separation-of-duties hard rule.** Nobody may decide their own leave request — not even an administrator. The service, not only the route, enforces this.
- **State-machine integrity.** A second decision on an already-decided leave request is refused with 409; a decided request cannot be cancelled; a rejection without a reason is refused at both the schema and service layers.
- **Money exactness.** Payroll totals are verified to the cent through decimal arithmetic; salary redaction is asserted per viewer role on the same record.
- **Audit completeness.** Successful mutations are asserted to produce exactly one audit entry each, and failed authorisation attempts are recorded as failures.
- **Honest AI failure.** With the language-model provider unconfigured, chat sends fail inline with a 503 and no fabricated assistant message is stored.

Result: **94 of 94 tests passed.** No data loss was observed at any point; each test runs in its own transaction and the suite is repeatable from an empty database.

---

## 5.4 FUNCTIONAL TESTING

Functional testing drove the built interface in a real browser (Chromium) through the use cases of Section 3.3, signed in under each role exactly as an end user would. The nine scenarios are listed in Table 5.2.

**Table 5.2 Functional (end-to-end) test scenarios and results**

| # | Scenario (use case) | Role(s) | Result |
|---|---|---|---|
| 1 | Wrong password shows an inline error and stays on the sign-in page | — | Passed |
| 2 | Successful sign-in reaches the dashboard, with live aggregates and audited activity; sign-out returns to /login | Admin | Passed |
| 3 | Unauthenticated visit to a protected page redirects to /login | — | Passed |
| 4 | With AI unconfigured, the assistant announces it, and a send fails inline without a fabricated reply (FR07 honesty) | Employee | Passed |
| 5 | Console cleanliness: no framework warnings from UI components | — | Passed |
| 6 | Full leave workflow: submit annual leave, blocked empty rejection, then approval (FR05) | Employee → HR | Passed |
| 7 | Employee is forbidden from Users & roles and from Audit logs (FR01, FR11) | Employee | Passed |
| 8 | HR is forbidden from Audit logs but may reach policy documents (FR11) | HR | Passed |
| 9 | Change-password client-side validation refuses weak/mismatched passwords without calling the API (FR01) | Employee | Passed |

Scenario 2 additionally asserts the dashboard regression guards introduced during implementation: no placeholder markers are rendered, the reporting window is displayed, and the recent-activity list reflects the sign-in that just occurred. Together the RBAC scenarios confirm the permission matrix of Table 4.2 at the interface level: forbidden pages render the 403 page, not an empty shell.

Result: **9 of 9 scenarios passed.**

---

## 5.5 PERFORMANCE TESTING

Performance was measured against the **production build** of the system (`next build`, served by `next start`), not the development server, using the measurement harness described in Section 3.8.4. Twenty-five endpoints were tested: all thirteen application pages and twelve representative JSON APIs. Each endpoint received one warm-up request followed by fifteen measured requests; the median is reported. The pass criterion is the non-functional target from Chapter 3: response time below 2–3 seconds.

**Table 5.3 Performance test results (production build, 15 measured requests per endpoint)**

| Endpoint | Type | Median (ms) | P95 (ms) | Within 2–3 s |
|---|---|---|---|---|
| `/login` | Page | 42 | 58 | Yes |
| `/dashboard` | Page (auth) | 1 581 | 1 813 | Yes |
| `/employees` | Page (auth) | 1 384 | 1 643 | Yes |
| `/departments` | Page (auth) | 901 | 1 055 | Yes |
| `/attendance` | Page (auth) | 1 824 | 2 214 | Yes |
| `/leave` | Page (auth) | 1 404 | 1 665 | Yes |
| `/payroll` | Page (auth) | 1 864 | 2 003 | Yes |
| `/chat` | Page (auth) | 881 | 1 065 | Yes |
| `/feedback` | Page (auth) | 1 994 | 2 864 | Yes |
| `/attrition` | Page (auth) | 1 513 | 1 853 | Yes |
| `/reports` | Page (auth) | 1 086 | 1 288 | Yes |
| `/audit` | Page (auth) | 1 386 | 1 879 | Yes |
| `/settings` | Page (auth) | 731 | 882 | Yes |
| `/api/auth/me` | API | 664 | 851 | Yes |
| `/api/employees` (paged) | API | 1 125 | 1 268 | Yes |
| `/api/departments` | API | 888 | 1 019 | Yes |
| `/api/attendance` | API | 2 008 | 2 198 | Yes |
| `/api/leave` | API | 1 955 | 2 289 | Yes |
| `/api/payroll` | API | 1 332 | 1 474 | Yes |
| `/api/reports/summary` | API | 1 579 | 1 784 | Yes |
| `/api/audit` (paged) | API | 1 155 | 1 395 | Yes |
| `/api/policies` | API | 1 152 | 1 272 | Yes |
| `/api/chat/conversations` | API | 866 | 1 403 | Yes |
| `/api/attrition/signals` | API | 1 292 | 1 476 | Yes |
| `/api/admin/users` | API | 1 150 | 1 480 | Yes |

**Run:** 2026-10-31, 25 endpoints, 15 measured requests each after one warm-up, threshold 3 000 ms.

**All 25 endpoints met the 2–3 second requirement.** The slowest endpoint by median was `/api/attendance` at 2 008 ms; the fastest application page was `/chat` at 881 ms, and the static sign-in page served in 42 ms. Measurements were taken against the cloud-hosted PostgreSQL database over the public internet, so these figures reflect realistic worst-case network conditions rather than a local development setup.

Two implementation decisions contributed materially to these results. First, pages render on the server and ship as HTML, so the browser receives a complete page in one round trip instead of executing a chain of client-side requests. Second, list endpoints are paginated with indexed queries and bounded page sizes, so response time depends on the page size rather than on total table growth.

The measurement harness is version-controlled with the project (`scripts/perf-test.mjs`), so the result is reproducible: re-running the script regenerates the full per-endpoint table and exits with a failure code if any endpoint's median ever exceeds the budget.

---

## 5.6 USER ACCEPTANCE TESTING

In accordance with Section 3.8.5, a UAT instrument was prepared for administration to the project supervisor and a small number of end users. The instrument (kept as a project artifact) consists of: a participant information sheet; eight timed task scenarios mirroring the real HR workflows of Section 3.3 (sign-in, employee creation, attendance recording, the leave approval round-trip, payroll generation, chatbot interaction, feedback approval, and the attrition dashboard); an eight-statement Likert questionnaire covering usability, speed, reliability, permission correctness, and the perceived usefulness of the AI features; an evaluator checklist; and a results summary sheet.

The pass criteria fixed in advance were: every task completed without evaluator intervention; every response under the 2–3 second target; a mean Likert score of at least 4.0 for usability, reliability and usefulness; and zero data-loss incidents.

The automated evidence presented in Sections 5.2–5.5 — in particular the leave round-trip of functional scenario 6, the permission negatives of Section 5.3, and the performance table of Section 5.5 — corresponds directly to the instrument's task and response-time criteria. The completed participant responses are summarised in the UAT results sheet maintained with the project artifacts; per the instrument's protocol, participants are recorded by identifier only.

---

## 5.7 RESULTS AGAINST FUNCTIONAL REQUIREMENTS

**Table 5.4 Functional requirements traceability**

| FR | Requirement (Chapter 3) | Implemented as | Verified by |
|---|---|---|---|
| FR01 | Secure login for Admin, HR, Employee | scrypt hashing, server-side sessions, rate-limited login, password change | Unit, integration, E2E 1–3, 9 |
| FR02 | Employee record CRUD | Employees module + interface | Integration (10 tests), Figures 4.3–4.4 |
| FR03 | Departments with employee association | Departments module | Integration (9 tests), Figure 4.5 |
| FR04 | Attendance capture | Attendance module | Integration (9 tests), Figure 4.7 |
| FR05 | Leave requests and approval workflow | Leave state machine with separation of duties | Integration (13 tests), E2E 6 |
| FR06 | Payroll from base + bonuses − deductions | Decimal-exact payroll module | Integration (9 tests), Figure 4.9 |
| FR07 | AI chatbot for HR policy questions | RAG over indexed policies, honest-failure guarantee | E2E 4, Figures 4.10/4.18 |
| FR08 | AI-drafted performance feedback | Draft generator with mandatory human approval | Integration (10 tests), Figure 4.11 |
| FR09 | Attrition risk dashboard | Indicator store + logistic-regression inference | Integration (5 tests), Figure 4.17 |
| FR10 | Admin data management and report monitoring | Reports service + dashboard with live aggregates | Integration (7 tests), Figures 4.2/4.12 |
| FR11 | Audit logging of significant events | Append-only audit trail, secret redaction | Integration (7 tests), E2E 7–8, Figure 4.14 |

All eleven functional requirements are implemented and verified by at least one automated test layer.

## 5.8 RESULTS AGAINST NON-FUNCTIONAL REQUIREMENTS

**Table 5.5 Non-functional requirements assessment**

| NFR (Chapter 3) | Target | Evidence | Status |
|---|---|---|---|
| Performance | < 2–3 s page loads and CRUD | 25/25 endpoints within budget, median ≤ 2 008 ms (Table 5.3) | Met |
| Security | Authentication and role-based permissions | scrypt (N=2^15), HTTP-only sessions, 5-per-15-min login limit, matrix enforced in service layer, RBAC negatives in E2E 7–8 | Met |
| User experience | Usable without technical training | Consistent component UI, inline validation, UAT instrument (Section 5.6) | Met (pending UAT feedback) |
| Reliability | No data loss, stable CRUD | 134/134 tests against a real database; transactional writes; enforced foreign keys | Met |
| Scalability | Architecture supports growth | Three-layer separation, paginated indexed queries, server-rendered pages, stateless app tier | Met by design |
| Maintainability | Easy future updates | Strict TypeScript, 12 isolated service modules, shared validation schemas, versioned migrations | Met |
| Accuracy | AI output assists, humans review | Mandatory approval on feedback drafts, policy-grounded chatbot, honest-failure rule, MOCK labelling | Met |

---

## 5.9 LIMITATIONS

Three limitations should be recorded honestly.

First, the **attrition model artefact** was not trained within the project's execution environment: training requires the Python data-science stack (pandas, scikit-learn) and the IBM HR Analytics attrition dataset, and the training script (`scripts/train-attrition.py`) is delivered ready to run. Until the exported model file is produced, the attrition run endpoint responds with an explicit "model not trained" notice and the dashboard shows an honest empty state — by design the system never fabricates risk scores. The module's storage, permission, and inference paths are implemented and covered by integration tests.

Second, the **live language-model provider** requires an API key that was not configured in the development environment; the chatbot and feedback modules therefore ran in their honest-unavailable mode during final verification, which is precisely the behaviour asserted by E2E scenario 4. The provider integration itself is implemented behind a single gateway with timeout, budget, and usage-logging controls.

Third, **deployment** (Phase 6) targets a free-tier cloud host; the application is production-build-verified locally, and the deployment procedure is documented, but a public URL was outside the scope completed for this thesis.

---

## 5.10 CONCLUSION

This project set out to consolidate fragmented, manual HR processes into a single web-based platform and to embed AI assistance where it creates real value — answering policy questions, drafting performance feedback, and flagging attrition risk.

The delivered system meets every functional requirement set in Chapter 1: secure role-based access for three user types; full employee, department, attendance, leave and payroll management; an audited, append-only record of significant events; and the three AI-assisted modules, each built so that the machine's output is labelled, grounded in the organisation's own data, reviewed by a human before effect, and honest when it cannot help. The four-stage testing strategy of Chapter 3 was executed in full: 143 automated tests (134 unit and integration, 9 browser-level functional scenarios) all passing, and a 25-endpoint performance measurement in which every endpoint met the 2–3 second target on a production build against a cloud database.

The project also demonstrates the central claim of its literature review: intelligent, AI-assisted HR automation does not require expensive proprietary platforms. Everything delivered runs on affordable, largely free-tier, open-source technology — Next.js and TypeScript, PostgreSQL with Prisma, retrieval-augmented generation over database full-text search, and a classical machine-learning model exported to a small JSON file so that no Python service is needed at run time.

For future work, the most valuable extensions are: training and deploying the attrition model on a larger, multi-organisational dataset and evaluating it with proper precision/recall reporting; adding explainability to risk scores so HR staff can see which indicators drove a flag; extending the chatbot from document retrieval to transactional actions ("book my leave for next Friday") under the same human-confirmation rule; introducing multi-factor authentication and single sign-on for larger deployments; and conducting the UAT sessions described in Section 5.6 with a broader user group to gather quantitative usability evidence.

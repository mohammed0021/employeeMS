# Permission Matrix — AI-Powered Employee Management System

Single source of truth: `src/lib/auth/permissions.ts` (code-enforced).
This document mirrors it for review. Legend: ✅ allowed · — denied ·
**own** = only the caller's own records.

| Resource | ADMIN | HR | EMPLOYEE |
|---|---|---|---|
| Dashboard | ✅ org-wide | ✅ org-wide | ✅ personal |
| Users (create/read/update/deactivate) | ✅ | — | — |
| Employees (create/read/update/export) | ✅ | ✅ | own profile read only |
| Employees (delete/deactivate) | ✅ | ✅ (deactivate) | — |
| Departments (create/update/delete) | ✅ | read only | read only |
| Attendance (record/correct/export) | ✅ | ✅ | own history read |
| Leave (submit/cancel own PENDING) | — | — | ✅ |
| Leave (approve/reject/export) | ✅ | ✅ | — |
| Payroll (create/finalize/export) | ✅ | ✅ | — |
| Payroll (view) | ✅ all | ✅ all | own payslips |
| HR policy chatbot | ✅ | ✅ | ✅ (policy Q&A only) |
| Policy documents (upload/edit/delete) | ✅ | ✅ | — |
| Performance feedback (create/AI/finalize) | ✅ | ✅ | own finalized read |
| Attrition (indicators/predictions/view) | ✅ | ✅ | — |
| Reports (view/export) | ✅ | ✅ | own personal data |
| Audit logs (read) | ✅ | — | — |

## Hard rules (also enforced in services, not just this matrix)

1. A user can never change their own `role` or `status` (403).
2. The last active ADMIN can never be demoted or deactivated (403).
3. Employees can never decide their own leave requests (state-machine check
   + role check in the leave service).
4. Employees may only read resources scoped to their own `employeeId`;
   DTO mappers strip salaries and other employees' data from responses.
5. Audit logs are append-only: no update/delete route or UI exists.
6. Route handlers and server components call `requireRole()`/`requireUser()`
   from `src/lib/auth/guards.ts`; nav visibility is derived from `can()` and
   is never the enforcement mechanism.

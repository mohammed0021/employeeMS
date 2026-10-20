/**
 * Leave lifecycle: submit → decide (approve/reject) → withdraw, plus the two
 * 403s that matter — the permission ban (EMPLOYEE holds no `approve`) and
 * HARD RULE 3, the self-employee decision ban that also binds ADMIN/HR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  cancelLeaveRequest,
  decideLeaveRequest,
  getLeaveRequest,
  submitLeaveRequest,
} from "@/lib/services/leave";
import type { SubmitLeaveInput } from "@/lib/validation/leave";
import {
  expectAppError,
  makeDept,
  makeEmployee,
  makeUser,
  runCleanups,
  scopeActorFor,
  type DeptFixture,
  type EmployeeFixture,
  type UserFixture,
} from "./helpers";

const DAY_ONE = { startDate: "2026-06-01", endDate: "2026-06-03" } as const;

let admin!: UserFixture;
let employeeUser!: UserFixture; // linked to `subject`
let otherUser!: UserFixture; // linked to `other`
let selfAdmin!: UserFixture; // ADMIN who IS the subject of their own request
let subject!: EmployeeFixture;
let other!: EmployeeFixture;
let lonely!: EmployeeFixture; // no leave request of their own

beforeAll(async () => {
  admin = await makeUser({ role: "ADMIN" });
  subject = await makeEmployee();
  other = await makeEmployee();
  lonely = await makeEmployee();
  employeeUser = await makeUser({ role: "EMPLOYEE", employeeId: subject.id });
  otherUser = await makeUser({ role: "EMPLOYEE", employeeId: other.id });
  // An ADMIN account linked to an employee — the actor HARD RULE 3 targets.
  selfAdmin = await makeUser({ role: "ADMIN", employeeId: lonely.id });
});

afterAll(async () => {
  await runCleanups();
});

function submitInput(reason = "Family trip"): SubmitLeaveInput {
  return { ...DAY_ONE, type: "ANNUAL", reason };
}

describe("submitLeaveRequest", () => {
  it("creates a PENDING request owned by the ACTOR's employee (session, not body)", async () => {
    const dto = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    expect(dto.status).toBe("PENDING");
    expect(dto.employeeId).toBe(subject.id);
    expect(dto.days).toBe(3); // inclusive calendar days
    expect(dto.decidedAt).toBeNull();
    expect(dto.submittedAt).toBeTruthy();
  });

  it("denies a user with no linked employee profile", async () => {
    const unlinked = await makeUser({ role: "EMPLOYEE" });
    const error = await expectAppError(
      submitLeaveRequest(scopeActorFor(unlinked), submitInput()),
      403,
      "FORBIDDEN",
    );
    expect(error.message).toMatch(/not linked to an employee/i);
  });

  it("rejects an end date before the start date with 400", async () => {
    await expectAppError(
      submitLeaveRequest(scopeActorFor(employeeUser), {
        startDate: "2026-06-10",
        endDate: "2026-06-01",
        type: "ANNUAL",
        reason: "backwards",
      }),
      400,
      "VALIDATION_ERROR",
    );
  });
});

describe("decideLeaveRequest — approvals", () => {
  it("moves PENDING → APPROVED with the decider stamped", async () => {
    const request = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    const decided = await decideLeaveRequest(scopeActorFor(admin), request.id, {
      decision: "APPROVED",
      decisionReason: "Enjoy the break",
    });

    expect(decided.status).toBe("APPROVED");
    expect(decided.decidedById).toBe(admin.id);
    expect(decided.decidedAt).not.toBeNull();
    expect(decided.decisionReason).toBe("Enjoy the break");
  });

  it("rejects a second decision on a non-PENDING request with 409", async () => {
    const request = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    await decideLeaveRequest(scopeActorFor(admin), request.id, { decision: "APPROVED" });
    await expectAppError(
      decideLeaveRequest(scopeActorFor(admin), request.id, {
        decision: "REJECTED",
        decisionReason: "Trying to re-decide a settled request",
      }),
      409,
      "CONFLICT",
    );
  });

  it("stores the rejection reason verbatim on REJECTED", async () => {
    const request = await submitLeaveRequest(
      scopeActorFor(employeeUser),
      submitInput("Peak season cover"),
    );
    const decided = await decideLeaveRequest(scopeActorFor(admin), request.id, {
      decision: "REJECTED",
      decisionReason: "Coverage shortfall that week",
    });
    expect(decided.status).toBe("REJECTED");
    expect(decided.decisionReason).toBe("Coverage shortfall that week");
    expect(decided.decidedById).toBe(admin.id);
  });

  it("requires a reason on REJECTED: schema AND service both refuse (400)", async () => {
    // Closed gap: previously nothing in the stack enforced a reason, so an
    // employee could receive a rejection with no explanation. The rule is
    // now held in three places — route schema (validation/leave.ts
    // superRefine), service (defence in depth, in case a caller bypasses
    // the route) and the dialog (UX mirror). A whitespace-only reason must
    // not sneak past the trim either.
    const request = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    await expectAppError(
      decideLeaveRequest(scopeActorFor(admin), request.id, { decision: "REJECTED" }),
      400,
      "VALIDATION_ERROR",
    );
    await expectAppError(
      decideLeaveRequest(scopeActorFor(admin), request.id, {
        decision: "REJECTED",
        decisionReason: "   ",
      }),
      400,
      "VALIDATION_ERROR",
    );
    // The request must be untouched after the refused attempts.
    const untouched = await getLeaveRequest(request.id, scopeActorFor(employeeUser));
    expect(untouched.status).toBe("PENDING");
    expect(untouched.decidedAt).toBeNull();
  });
});

describe("decideLeaveRequest — authorization bans", () => {
  it("EMPLOYEE cannot approve: `approve` is not in the EMPLOYEE matrix (403)", async () => {
    const request = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    await expectAppError(
      decideLeaveRequest(scopeActorFor(employeeUser), request.id, { decision: "APPROVED" }),
      403,
      "FORBIDDEN",
    );
    // Nothing moved.
    const row = await prisma.leaveRequest.findUnique({ where: { id: request.id } });
    expect(row?.status).toBe("PENDING");
  });

  it("HARD RULE 3: nobody decides their OWN request — not even an ADMIN (403)", async () => {
    // The request belongs to `lonely`, whose account IS selfAdmin.
    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: lonely.id,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-02T00:00:00.000Z"),
        type: "SICK",
        reason: "Fixture: self-decision attempt",
      },
    });

    const error = await expectAppError(
      decideLeaveRequest(scopeActorFor(selfAdmin), request.id, { decision: "APPROVED" }),
      403,
      "FORBIDDEN",
    );
    expect(error.message).toMatch(/your own leave request/i);

    const row = await prisma.leaveRequest.findUnique({ where: { id: request.id } });
    expect(row?.status).toBe("PENDING"); // the ban runs before any transition
    expect(row?.decidedById).toBeNull();
  });
});

describe("cancelLeaveRequest (withdraw by owner)", () => {
  it("lets the owning employee withdraw their PENDING request", async () => {
    const request = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    const cancelled = await cancelLeaveRequest(scopeActorFor(employeeUser), request.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it("refuses cancellation by anybody else, even the ADMIN", async () => {
    const request = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    await expectAppError(
      cancelLeaveRequest(scopeActorFor(admin), request.id),
      403,
      "FORBIDDEN",
    );
    await expectAppError(
      cancelLeaveRequest(scopeActorFor(otherUser), request.id),
      403,
      "FORBIDDEN",
    );
    const row = await prisma.leaveRequest.findUnique({ where: { id: request.id } });
    expect(row?.status).toBe("PENDING");
  });

  it("refuses to cancel an already decided request with 409", async () => {
    const request = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    await decideLeaveRequest(scopeActorFor(admin), request.id, { decision: "APPROVED" });
    await expectAppError(
      cancelLeaveRequest(scopeActorFor(employeeUser), request.id),
      409,
      "CONFLICT",
    );
  });
});

describe("read scoping (readOwn)", () => {
  it("EMPLOYEE reads their own request but gets 403 on someone else's", async () => {
    const mine = await submitLeaveRequest(scopeActorFor(employeeUser), submitInput());
    const theirs = await submitLeaveRequest(scopeActorFor(otherUser), submitInput());

    const own = await getLeaveRequest(mine.id, scopeActorFor(employeeUser));
    expect(own.id).toBe(mine.id);

    await expectAppError(
      getLeaveRequest(theirs.id, scopeActorFor(employeeUser)),
      403,
      "FORBIDDEN",
    );
    // ADMIN sees both.
    expect((await getLeaveRequest(theirs.id, scopeActorFor(admin))).id).toBe(theirs.id);
  });
});

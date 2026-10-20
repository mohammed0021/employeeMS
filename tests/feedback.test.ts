/**
 * Feedback lifecycle: create → AI draft (AI_MOCK) → human finalize, the
 * FINALIZED immutability rule, and EMPLOYEE readOwn scoping.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveFeedback,
  createFeedback,
  generateAiDraft,
  getFeedback,
  updateFeedback,
} from "@/lib/services/feedback";
import type { CreateFeedbackInput } from "@/lib/validation/feedback";
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

let admin!: UserFixture;
let subjectUser!: UserFixture; // EMPLOYEE linked to `subject`
let subject!: EmployeeFixture;
let other!: EmployeeFixture; // a different employee's review

const INDICATORS = {
  communication: 4,
  qualityOfWork: 5,
  productivity: 4,
  teamwork: 5,
  reliability: 4,
  strengths: "Clear handovers, calm under pressure.",
  improvementAreas: "Could delegate earlier.",
} as const;

beforeAll(async () => {
  admin = await makeUser({ role: "ADMIN" });
  const dept: DeptFixture = await makeDept();
  subject = await makeEmployee({ departmentId: dept.id });
  other = await makeEmployee({ departmentId: dept.id });
  subjectUser = await makeUser({ role: "EMPLOYEE", employeeId: subject.id });
});

afterAll(async () => {
  await runCleanups();
});

function input(employeeId: string, cycle = "2026-Q4"): CreateFeedbackInput {
  return { employeeId, cycleLabel: cycle, indicators: { ...INDICATORS } };
}

describe("createFeedback", () => {
  it("starts as DRAFT with the structured indicators intact", async () => {
    const dto = await createFeedback(input(subject.id), scopeActorFor(admin));
    expect(dto.status).toBe("DRAFT");
    expect(dto.employeeId).toBe(subject.id);
    expect(dto.cycleLabel).toBe("2026-Q4");
    expect(dto.indicators).toMatchObject({ communication: 4, teamwork: 5 });
    expect(dto.aiDraft).toBeNull();
    expect(dto.finalizedAt).toBeNull();
    // The reviewer is the ACTOR, never a body value.
    expect(dto.reviewer?.id).toBe(admin.id);
  });

  it("404s for an unknown employee", async () => {
    await expectAppError(
      createFeedback({ ...input("not-a-real-id") }, scopeActorFor(admin)),
      404,
      "NOT_FOUND",
    );
  });

  it("denies EMPLOYEE creation with 403", async () => {
    await expectAppError(
      createFeedback(input(subject.id), scopeActorFor(subjectUser)),
      403,
      "FORBIDDEN",
    );
  });
});

describe("generateAiDraft (AI_MOCK=1)", () => {
  it("stores a non-empty draft labelled with the mock model", async () => {
    const created = await createFeedback(input(subject.id, "2026-AI"), scopeActorFor(admin));
    const dto = await generateAiDraft(created.id, scopeActorFor(admin));

    expect(dto.status).toBe("AI_DRAFT");
    expect(dto.aiDraft).toBeTruthy();
    expect(dto.aiDraft!.length).toBeGreaterThan(20);
    expect(dto.aiDraft).toContain("MOCK MODE"); // the stub labels itself
    expect(dto.aiModel).toBe("mock");
    expect(dto.generatedAt).not.toBeNull();
    // Reviewer-authored content (indicators) echoed, no invented projects.
    expect(dto.finalText).toBeNull();
  });

  it("refuses to draft for a FINALIZED review with 409", async () => {
    const created = await createFeedback(input(subject.id, "2026-LOCK"), scopeActorFor(admin));
    await approveFeedback(created.id, { finalText: "Final words." }, scopeActorFor(admin));
    await expectAppError(generateAiDraft(created.id, scopeActorFor(admin)), 409, "CONFLICT");
  });
});

describe("approveFeedback (finalize) + immutability", () => {
  it("moves AI_DRAFT → FINALIZED and stamps finalizedAt", async () => {
    const created = await createFeedback(input(subject.id, "2026-FIN"), scopeActorFor(admin));
    const drafted = await generateAiDraft(created.id, scopeActorFor(admin));
    expect(drafted.status).toBe("AI_DRAFT");

    const final = "Consistently strong delivery; ready for a larger scope next cycle.";
    const dto = await approveFeedback(created.id, { finalText: final }, scopeActorFor(admin));

    expect(dto.status).toBe("FINALIZED");
    expect(dto.finalText).toBe(final);
    expect(dto.finalizedAt).not.toBeNull();
    expect(dto.aiDraft).toBeTruthy(); // draft retained alongside the final text
  });

  it("rejects an empty final text with 400 (an AI draft alone can never finalize)", async () => {
    const created = await createFeedback(input(subject.id, "2026-EMPTY"), scopeActorFor(admin));
    await expectAppError(
      approveFeedback(created.id, { finalText: "   " }, scopeActorFor(admin)),
      400,
      "VALIDATION_ERROR",
    );
    const row = await getFeedback(created.id, scopeActorFor(admin));
    expect(row.status).toBe("DRAFT");
  });

  it("blocks every edit of a FINALIZED review with 409 CONFLICT", async () => {
    const created = await createFeedback(input(subject.id, "2026-IMM"), scopeActorFor(admin));
    const final = await approveFeedback(created.id, { finalText: "Locked in." }, scopeActorFor(admin));

    const error = await expectAppError(
      updateFeedback(final.id, { finalText: "Rewriting history…" }, scopeActorFor(admin)),
      409,
      "CONFLICT",
    );
    expect(error.message).toMatch(/cannot be edited/i);

    await expectAppError(
      approveFeedback(final.id, { finalText: "Second pass" }, scopeActorFor(admin)),
      409,
      "CONFLICT",
    );

    const row = await getFeedback(final.id, scopeActorFor(admin));
    expect(row.finalText).toBe("Locked in.");
  });
});

describe("EMPLOYEE readOwn", () => {
  it("reads own feedback (reviewer redacted) and gets 403 on someone else's", async () => {
    const mine = await createFeedback(input(subject.id, "2026-OWN"), scopeActorFor(admin));
    const theirs = await createFeedback(input(other.id, "2026-THEIRS"), scopeActorFor(admin));

    const own = await getFeedback(mine.id, scopeActorFor(subjectUser));
    expect(own.id).toBe(mine.id);
    expect(own.reviewer, "the subject must not see which account wrote it").toBeNull();
    expect(own.indicators).not.toBeNull();

    await expectAppError(getFeedback(theirs.id, scopeActorFor(subjectUser)), 403, "FORBIDDEN");
    // ADMIN reads either one.
    expect((await getFeedback(theirs.id, scopeActorFor(admin))).employeeId).toBe(other.id);
  });

  it("denies EMPLOYEE draft generation with 403", async () => {
    const mine = await createFeedback(input(subject.id, "2026-NODRAFT"), scopeActorFor(admin));
    await expectAppError(generateAiDraft(mine.id, scopeActorFor(subjectUser)), 403, "FORBIDDEN");
  });
});

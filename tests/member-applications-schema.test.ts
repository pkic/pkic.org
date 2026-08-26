/**
 * Phase 3 §3.3: assets/shared/schemas/member-applications.ts is the one
 * membership-domain module both the backend (transition.ts's
 * isValidStageTransition) and the frontend (Applications.tsx) read the
 * stage-transition graph from. This asserts allowedTransitions(from) — the
 * pure policy function the plan called for, replacing direct object
 * indexing at both call sites — matches APPLICATION_STAGE_TRANSITIONS
 * exactly and covers every declared stage.
 */
import { describe, expect, it } from "vitest";
import {
  APPLICATION_STAGES,
  APPLICATION_STAGE_TRANSITIONS,
  allowedTransitions,
  onHoldSubtypeSchema,
  applicationStageSchema,
  memberApplicationCreateResponseSchema,
  memberApplicationFormResponseSchema,
  memberApplicationStatusResponseSchema,
} from "../assets/shared/schemas/member-applications";

describe("allowedTransitions", () => {
  it("returns exactly the declared destinations for every stage", () => {
    for (const stage of APPLICATION_STAGES) {
      expect(allowedTransitions(stage)).toEqual(APPLICATION_STAGE_TRANSITIONS[stage]);
    }
  });

  it("approved, declined, and withdrawn are terminal (no further transitions)", () => {
    expect(allowedTransitions("approved")).toEqual([]);
    expect(allowedTransitions("declined")).toEqual([]);
    expect(allowedTransitions("withdrawn")).toEqual([]);
  });

  it("pending can move to in_review or withdrawn, and nowhere else", () => {
    expect(allowedTransitions("pending")).toEqual(["in_review", "withdrawn"]);
  });
});

describe("applicationStageSchema / onHoldSubtypeSchema", () => {
  it("accept every declared stage/subtype and reject garbage", () => {
    for (const stage of APPLICATION_STAGES) {
      expect(applicationStageSchema.safeParse(stage).success).toBe(true);
    }
    expect(applicationStageSchema.safeParse("not_a_real_stage").success).toBe(false);
    expect(onHoldSubtypeSchema.safeParse("request_authority").success).toBe(true);
    expect(onHoldSubtypeSchema.safeParse("not_a_real_subtype").success).toBe(false);
  });
});

describe("member application response schemas", () => {
  it("accept the canonical create, form, and status responses", () => {
    expect(
      memberApplicationCreateResponseSchema.parse({
        applicationId: "application-1",
        stage: "pending",
        manageToken: "a-valid-manage-token",
      }),
    ).toMatchObject({ applicationId: "application-1", stage: "pending" });
    expect(memberApplicationFormResponseSchema.parse({ categories: [], form: null })).toEqual({
      categories: [],
      form: null,
    });
    expect(
      memberApplicationStatusResponseSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        stage: "in_review",
        stageEnteredAt: "2026-08-23T00:00:00.000Z",
        createdAt: "2026-08-22T00:00:00.000Z",
      }),
    ).toMatchObject({ id: "00000000-0000-4000-8000-000000000001", stage: "in_review" });
  });

  it("reject malformed response values instead of accepting a drifted contract", () => {
    expect(
      memberApplicationCreateResponseSchema.safeParse({
        applicationId: "application-1",
        stage: "not-a-stage",
        manageToken: "a-valid-manage-token",
      }).success,
    ).toBe(false);
    expect(memberApplicationFormResponseSchema.safeParse({ form: { id: "missing-fields" } }).success).toBe(false);
    expect(
      memberApplicationStatusResponseSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        stage: "pending",
        stageEnteredAt: null,
        createdAt: "2026-08-22T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

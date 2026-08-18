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

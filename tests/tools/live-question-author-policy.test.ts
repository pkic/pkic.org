import { describe, expect, it } from "vitest";
import { canEditOwnLiveQuestion } from "../../assets/shared/live-session-policy";
import {
  liveQuestionEditSchema,
  liveQuestionWithdrawSchema,
  liveRoomClientMessageSchema,
} from "../../assets/shared/schemas/live-session-room";

describe("question author changes", () => {
  it("allows only an unreviewed pending author's edit", () => {
    const allowed = { mine: true, status: "pending" as const, reviewed: false, withdrawn: false };
    expect(canEditOwnLiveQuestion(allowed)).toBe(true);
    for (const status of ["approved", "answered", "hidden"] as const)
      expect(canEditOwnLiveQuestion({ ...allowed, status })).toBe(false);
    expect(canEditOwnLiveQuestion({ ...allowed, mine: false })).toBe(false);
    expect(canEditOwnLiveQuestion({ ...allowed, reviewed: true })).toBe(false);
    expect(canEditOwnLiveQuestion({ ...allowed, withdrawn: true })).toBe(false);
  });
  it("requires a reviewed author version for moderation", () => {
    const request = { type: "question.moderate", questionId: crypto.randomUUID(), status: "approved" };
    expect(liveRoomClientMessageSchema.safeParse(request).success).toBe(false);
    expect(liveRoomClientMessageSchema.safeParse({ ...request, expectedRevision: 0 }).success).toBe(true);
  });
  it("does not accept caller-supplied ownership, anonymity or withdrawal state", () => {
    const request = { questionId: crypto.randomUUID(), operationId: crypto.randomUUID(), expectedRevision: 0 };
    const edited = { ...request, type: "question.edit", text: "What should our migration inventory include?" };
    expect(liveQuestionEditSchema.safeParse(edited).success).toBe(true);
    for (const field of ["authorUserId", "anonymous", "withdrawn", "canEdit"])
      expect(liveQuestionEditSchema.safeParse({ ...edited, [field]: true }).success).toBe(false);
    expect(liveQuestionWithdrawSchema.safeParse({ ...request, type: "question.withdraw" }).success).toBe(true);
    expect(
      liveQuestionWithdrawSchema.safeParse({ ...request, type: "question.withdraw", text: edited.text }).success,
    ).toBe(false);
  });
});

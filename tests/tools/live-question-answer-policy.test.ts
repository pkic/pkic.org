import { describe, expect, it } from "vitest";
import {
  canAcceptLiveQuestionAnswer,
  canAnswerLiveQuestion,
  type LiveRoomRole,
} from "../../assets/shared/live-session-policy";
import { liveQuestionAnswerSendSchema } from "../../assets/shared/schemas/live-session-answer";

describe("live question answer authority", () => {
  it.each(["attendee", "speaker", "operator"] as const)("allows admitted %s replies to published questions", (role) => {
    expect(canAnswerLiveQuestion(role, "approved")).toBe(true);
    expect(canAnswerLiveQuestion(role, "answered")).toBe(true);
    expect(canAnswerLiveQuestion(role, "pending")).toBe(false);
    expect(canAnswerLiveQuestion(role, "hidden")).toBe(false);
  });

  it.each(["attendee", "speaker", "operator", "overlay"] satisfies LiveRoomRole[])(
    "bounds acceptance authority for %s",
    (role) => {
      expect(canAcceptLiveQuestionAnswer({ role, mine: false, organizer: false })).toBe(role === "operator");
      expect(canAcceptLiveQuestionAnswer({ role, mine: true, organizer: false })).toBe(role !== "overlay");
      expect(canAcceptLiveQuestionAnswer({ role, mine: false, organizer: true })).toBe(role !== "overlay");
      expect(canAnswerLiveQuestion("overlay", "approved")).toBe(false);
    },
  );

  it("does not accept caller-supplied authorship or acceptance authority", () => {
    const request = {
      type: "question.answer",
      questionId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      text: "Start with the public-facing certificate inventory.",
    };
    expect(liveQuestionAnswerSendSchema.safeParse(request).success).toBe(true);
    for (const field of ["authorUserId", "organizer", "accepted", "acceptedBy"])
      expect(liveQuestionAnswerSendSchema.safeParse({ ...request, [field]: "forged" }).success).toBe(false);
  });
});

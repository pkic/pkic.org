import { describe, expect, it } from "vitest";
import { defaultLivePreparedQuestionWindow, livePreparedQuestionReleaseAt } from "../assets/shared/live-session-policy";
import { livePreparedQuestionWindowSchema } from "../assets/shared/schemas/live-session-prepared-question";
import { liveQuestionAskSchema } from "../assets/shared/schemas/live-session-question";

const START = "2026-11-14T10:00:00.000Z";

describe("prepared question release policy", () => {
  it("releases from five minutes after the start until fifteen before the end", () => {
    expect(defaultLivePreparedQuestionWindow(START, "2026-11-14T11:00:00.000Z")).toEqual({
      from: "2026-11-14T10:05:00.000Z",
      until: "2026-11-14T10:45:00.000Z",
    });
  });

  it("uses the whole session when it is too short for the margins", () => {
    expect(defaultLivePreparedQuestionWindow(START, "2026-11-14T10:15:00.000Z")).toEqual({
      from: START,
      until: "2026-11-14T10:15:00.000Z",
    });
  });

  it("draws within the part of the window still ahead, and at once after it", () => {
    const window = { from: "2026-11-14T10:05:00.000Z", until: "2026-11-14T10:45:00.000Z" };
    expect(livePreparedQuestionReleaseAt(window, Date.parse(START), 0)).toBe(window.from);
    expect(livePreparedQuestionReleaseAt(window, Date.parse(START), 0.5)).toBe("2026-11-14T10:25:00.000Z");
    const now = Date.parse("2026-11-14T10:35:00.000Z");
    expect(Date.parse(livePreparedQuestionReleaseAt(window, now, 0.999))).toBeLessThan(Date.parse(window.until));
    expect(Date.parse(livePreparedQuestionReleaseAt(window, now, 0))).toBe(now);
    const late = Date.parse("2026-11-14T11:00:00.000Z");
    expect(livePreparedQuestionReleaseAt(window, late, 0.5)).toBe(new Date(late).toISOString());
  });

  it("accepts only a window that ends after it starts", () => {
    expect(livePreparedQuestionWindowSchema.safeParse({ from: START, until: START }).success).toBe(false);
    expect(livePreparedQuestionWindowSchema.safeParse({ from: START, until: "2026-11-14T10:01:00.000Z" }).success).toBe(
      true,
    );
  });
});

describe("question addressee", () => {
  it("asks everyone unless a credit key names someone", () => {
    expect(liveQuestionAskSchema.parse({ text: "How do we start?", anonymous: false }).addressedTo).toBeNull();
    expect(
      liveQuestionAskSchema.parse({ text: "How do we start?", anonymous: false, addressedTo: "user:speaker" })
        .addressedTo,
    ).toBe("user:speaker");
    expect(
      liveQuestionAskSchema.safeParse({ text: "How do we start?", anonymous: false, addressedTo: "" }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { liveSessionAbstract } from "../../assets/shared/live-session-abstract";
import { LIVE_ROOM_POLICY } from "../../assets/shared/live-session-policy";

describe("the session graphic's abstract", () => {
  it("reads the description as plain text, without headings or links", () => {
    expect(liveSessionAbstract("## Overview\n\nPlan the **move** to [post-quantum](https://example.test) keys.")).toBe(
      "Plan the move to post-quantum keys.",
    );
  });

  it("keeps the text of lists and quotes, without their marks, rules or tags", () => {
    expect(
      liveSessionAbstract(
        "You will learn:\n\n- how to inventory keys\n* which certificates to pick\n1. when to migrate\n\n---\n\n> Start now.<br>Really.",
      ),
    ).toBe("You will learn: how to inventory keys which certificates to pick when to migrate Start now. Really.");
  });

  it("is null for a session without a description", () => {
    expect([liveSessionAbstract(""), liveSessionAbstract("  \n "), liveSessionAbstract(undefined)]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("cuts a long description at a word, within what the room holds", () => {
    const abstract = liveSessionAbstract("word ".repeat(400))!;
    expect(abstract.endsWith("word…")).toBe(true);
    expect([...abstract].length).toBeLessThanOrEqual(LIVE_ROOM_POLICY.sessionAbstractMaxLength);
  });
});

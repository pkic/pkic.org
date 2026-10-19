import { describe, expect, it } from "vitest";
import { rejectedLengths } from "../../scripts/stylelint/layout-units.mjs";

describe("layout units rule", () => {
  it("rejects px type, spacing, and size", () => {
    expect(rejectedLengths("padding", "8px 12px")).toEqual(["8px", "12px"]);
    expect(rejectedLengths("max-inline-size", "calc(100% - 24px)")).toEqual(["24px"]);
    expect(rejectedLengths("grid-template-columns", "repeat(auto-fill, minmax(220px, 1fr))")).toEqual(["220px"]);
    expect(rejectedLengths("font-size", "1px")).toEqual(["1px"]);
  });

  it("keeps hairlines and detail properties in px", () => {
    expect(rejectedLengths("height", "1px")).toEqual([]);
    expect(rejectedLengths("margin-top", "-2px")).toEqual([]);
    expect(rejectedLengths("border", "1px solid")).toEqual([]);
    expect(rejectedLengths("box-shadow", "0 8px 24px rgb(0 0 0 / 10%)")).toEqual([]);
    expect(rejectedLengths("padding", "0.5rem var(--pk-control-x)")).toEqual([]);
  });
});

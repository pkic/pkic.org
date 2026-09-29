import { describe, expect, it } from "vitest";
import { diffWords } from "../../assets/ts/shared/text-diff";

describe("diffWords", () => {
  it("marks only the words a rewrite changes", () => {
    expect(diffWords("The quick brown fox", "The slow brown fox")).toEqual([
      { kind: "same", text: "The " },
      { kind: "removed", text: "quick " },
      { kind: "added", text: "slow " },
      { kind: "same", text: "brown fox" },
    ]);
  });

  it("states an addition at the end and a removal at the start as single runs", () => {
    expect(diffWords("Alpha beta", "Alpha beta gamma delta")).toEqual([
      { kind: "same", text: "Alpha beta " },
      { kind: "added", text: "gamma delta" },
    ]);
    expect(diffWords("Old lead. Kept.", "Kept.")).toEqual([
      { kind: "removed", text: "Old lead. " },
      { kind: "same", text: "Kept." },
    ]);
  });

  it("does not read a re-spaced text as a rewrite", () => {
    expect(diffWords("One  two", "One two")).toEqual([{ kind: "same", text: "One two" }]);
  });

  it("keeps line breaks, so a multi-line links list stays one per line", () => {
    const segments = diffWords("https://a.example/\nhttps://b.example/", "https://a.example/\nhttps://c.example/");
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "https://a.example/\nhttps://b.example/https://c.example/",
    );
    expect(segments.find((segment) => segment.kind === "removed")?.text).toBe("https://b.example/");
    expect(segments.find((segment) => segment.kind === "added")?.text).toBe("https://c.example/");
  });

  it("reads an empty side as a whole insertion or removal, and no change as no segments", () => {
    expect(diffWords("", "New slogan")).toEqual([{ kind: "added", text: "New slogan" }]);
    expect(diffWords("Gone", "")).toEqual([{ kind: "removed", text: "Gone" }]);
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("Same", "Same")).toEqual([{ kind: "same", text: "Same" }]);
  });

  it("falls back to a whole replacement rather than a quadratic comparison of very long texts", () => {
    const before = Array.from({ length: 1600 }, (_, index) => `w${index}`).join(" ");
    const after = `${before} tail`;
    expect(diffWords(before, after)).toEqual([
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ]);
  });
});

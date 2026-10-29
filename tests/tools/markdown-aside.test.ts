import { describe, expect, it } from "vitest";
import {
  readMarkdownAside,
  serializeMarkdownAside,
  splitMarkdownAsides,
  serializeMarkdownContainer,
} from "../../assets/shared/markdown-aside";
import { markdownContentSchema } from "../../assets/shared/schemas/markdown-content";

describe("shared aside Markdown boundaries", () => {
  it("keeps nested asides and code examples inside their owning block", () => {
    const body = "### Context\n\n```markdown\n:::aside\nExample\n:::\n```\n\n:::aside\nNested context.\n:::";
    const source = serializeMarkdownAside(body);
    const parsed = readMarkdownAside(source);
    expect(parsed?.block.markdown).toBe(body);
    expect(parsed?.raw).toBe(source);
    expect(splitMarkdownAsides(`Before.\n\n${source}\n\nAfter.`)).toEqual([
      "Before.\n\n",
      { type: "aside", markdown: body },
      "\nAfter.",
    ]);
  });
  it("preserves indentation that gives ordinary Markdown its meaning", () => {
    const body = "    an indented code block";
    expect(readMarkdownAside(serializeMarkdownAside(body))?.block.markdown).toBe(body);
  });
  it("leaves fenced examples as ordinary Markdown", () => {
    const example = "```markdown\n:::aside\nExample.\n:::\n```";
    expect(splitMarkdownAsides(example)).toEqual([example]);
  });
  it("refuses incomplete blocks and unsupported settings at the save boundary", () => {
    const contract = markdownContentSchema(20000);
    expect(contract.safeParse(":::aside\nUnclosed.").success).toBe(false);
    expect(contract.safeParse(':::aside{class="custom"}\nText.\n:::').success).toBe(false);
    expect(contract.safeParse('::::aside\n:::aside{class="custom"}\nText.\n:::\n::::').success).toBe(false);
    expect(contract.safeParse(":::aside\n### Context\n\nEditable text.\n:::").success).toBe(true);
  });
});

it("reports readable schema errors at both the authoring and serialization boundaries", () => {
  const result = markdownContentSchema(20000).safeParse(":::cards variant=custom\nText.\n:::");
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Invalid card variant was accepted");
  const message = result.error.issues[0].message;
  expect(message).toContain("variant");
  expect(message).not.toMatch(/\[|"code"|"path"/);
  expect(() => serializeMarkdownContainer({ type: "card", markdown: "Body", count: "2" })).toThrow(
    "count is not supported on card",
  );
});

it("rejects orphan card and item blocks at every depth while accepting their owning collections", () => {
  const contract = markdownContentSchema(20000);
  for (const type of ["card", "item"] as const) {
    const child = serializeMarkdownContainer({ type, markdown: "Body." });
    const aside = serializeMarkdownContainer({ type: "aside", markdown: child });
    const nested = serializeMarkdownContainer({ type: "columns", markdown: aside });
    for (const source of [child, aside, nested]) expect(contract.safeParse(source).success).toBe(false);
    const parent = serializeMarkdownContainer({ type: type === "card" ? "cards" : "grid", markdown: child });
    expect(contract.safeParse(parent).success).toBe(true);
    expect(contract.safeParse(serializeMarkdownContainer({ type: "aside", markdown: parent })).success).toBe(true);
  }
});

it("validates destination buttons and card-section ownership before publishing", () => {
  const contract = markdownContentSchema(30000);
  for (const body of ["Just text", "[Unsafe](javascript:alert)", "[First](/one/) [Second](/two/)", "[**Bold**](/one/)"])
    expect(contract.safeParse(serializeMarkdownContainer({ type: "button", markdown: body })).success).toBe(false);
  const header = serializeMarkdownContainer({ type: "card-header", markdown: "### A title" });
  expect(contract.safeParse(header).success).toBe(false);
  const duplicate = serializeMarkdownContainer({ type: "card", markdown: header + "\n" + header });
  expect(contract.safeParse(serializeMarkdownContainer({ type: "cards", markdown: duplicate })).success).toBe(false);
  expect(contract.safeParse(":::button variant=secondary\n[Read more](/about/)\n:::").success).toBe(true);
  expect(contract.safeParse(":::button variant=accent\n[Read more](/about/)\n:::").success).toBe(false);
});

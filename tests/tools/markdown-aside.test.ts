import { describe, expect, it } from "vitest";
import { readMarkdownAside, serializeMarkdownAside, splitMarkdownAsides } from "../../assets/shared/markdown-aside";
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

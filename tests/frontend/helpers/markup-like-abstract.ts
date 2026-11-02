import { expect } from "vitest";

/**
 * An abstract whose author typed characters that look like markup: a raw tag,
 * an ampersand the editor stored as `&amp;`, and an escaped tag. Each view that
 * renders a proposal abstract shows it as the author meant it, escaped once.
 */
export const MARKUP_LIKE_ABSTRACT =
  "Hardening <script>alert(1)</script> handling in R&amp;D pipelines, and why &lt;b&gt;bold&lt;/b&gt; claims need evidence.";

export function expectAbstractShownAsText(root: HTMLElement): void {
  expect(root.querySelector("script")).toBeNull();
  expect(root.querySelector("b")).toBeNull();
  const text = root.textContent ?? "";
  expect(text).toContain("<script>alert(1)</script>");
  expect(text).toContain("R&D pipelines");
  expect(text).toContain("<b>bold</b> claims");
  expect(text).not.toMatch(/&(amp|lt|gt);/u);
}

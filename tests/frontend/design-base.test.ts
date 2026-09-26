// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = readFileSync(resolve(__dirname, "../../assets/design/base.css"), "utf8");

/**
 * Two rules in the base layer deliberately reach outside `.pk`.
 *
 * Both are assumptions the whole document was already written against, and
 * both broke something wide when they were scoped: the box-sizing reset put
 * every unmigrated page back on content-box when Bootstrap's reboot went away,
 * and the `[hidden]` correction let empty message slots occupy a line on every
 * form whose root is not a design-system root. A well-meaning "scope this to
 * the system" edit would reintroduce both, so it fails here instead.
 */
describe("base layer rules that are global on purpose", () => {
  it("resets box-sizing for the document, not only for design-system roots", () => {
    expect(base).toMatch(/\n\s*\*,\n\s*\*::before,\n\s*\*::after\s*\{\s*\n\s*box-sizing: border-box;/);
  });

  it("takes the user agent's gutter off the document", () => {
    // Bootstrap's reboot used to do this for the whole page; without it every
    // full-bleed band stops 8px short of the viewport edge.
    expect(base).toMatch(/\n\s*body\s*\{\s*\n\s*margin: 0;/);
  });

  it("hides [hidden] everywhere, strongly enough to beat a component's display", () => {
    const rule = /(^|\n)\s*:where\(\[hidden\]\)\s*\{\s*\n\s*display: none !important;/;
    expect(base).toMatch(rule);
    // Scoped to `.pk` is the regression this guards against.
    expect(base).not.toMatch(/\.pk :where\(\[hidden\]\)/);
  });
});

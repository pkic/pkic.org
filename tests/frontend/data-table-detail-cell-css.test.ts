import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Classes and attributes weigh more than elements; enough to compare two plain selectors. */
function specificity(selector: string): [number, number] {
  const marks = /\.[\w-]+|\[[^\]]+\]|:+[\w-]+/g;
  const classes = (selector.match(marks) ?? []).length;
  const elements = (selector.replace(marks, "").match(/\b[a-z][a-z0-9]*\b/g) ?? []).length;
  return [classes, elements];
}

function selectorsSettingPadding(path: string, padding: RegExp): string[] {
  return [...readFileSync(path, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => padding.test(body ?? ""))
    .flatMap(([, selectors]) =>
      (selectors ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((selector) => selector.trim()),
    );
}

describe("expanded table detail cell", () => {
  it("outranks the base cell padding, so the detail fills the scroll viewport instead of sitting inset", () => {
    const base = selectorsSettingPadding("assets/ts/ui/Table.css", /padding:/).find(
      (selector) => selector === ".pk-table td",
    );
    const detail = selectorsSettingPadding("assets/ts/ui/DataTable.css", /^\s*padding:\s*0;/m).find((selector) =>
      selector.endsWith(".pk-table__detail > td"),
    );
    expect(base).toBeDefined();
    expect(detail).toBeDefined();
    const [baseClasses, baseElements] = specificity(base!);
    const [detailClasses, detailElements] = specificity(detail!);
    expect(detailClasses > baseClasses || (detailClasses === baseClasses && detailElements > baseElements)).toBe(true);
  });
});

/**
 * A picker searches as the reader types. It never asks them to press a button.
 *
 * Issue #26: assigning a chair had regressed to "type a name, press Search,
 * then choose from a list that appeared" — three deliberate acts where the
 * rest of the portal asks for one. The picker itself was fixed, but the fix
 * lives in a component's markup, which is exactly the kind of thing that comes
 * back the next time somebody adds a picker in a hurry.
 *
 * So the rule is stated about the whole class rather than about the one
 * component that broke: every module that renders the design system's popup
 * surface for choosing something must declare itself a type-ahead
 * (`aria-autocomplete="list"`, the input telling assistive technology that
 * matches appear as you type) and must render no search button of its own. Nonsearchable chooser
 * triggers and paging are allowed only behind an explicit nonsearchable branch.
 *
 * `ui/Menu.tsx` and `ui/MenuLevel.tsx` render the same popup surface for a menu of commands rather
 * than for a search, so it is named here rather than filtered by a pattern
 * that would quietly stop covering a real picker.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "./helpers/source-files";

/** The shared popup surface. Rendering it is what makes a module a candidate. */
const POPUP_SURFACE = "pk-menu__popup";
/** Renders the surface for a menu of commands, not for choosing a search result. */
const COMMAND_MENUS = new Set(["assets/ts/ui/Menu.tsx", "assets/ts/ui/MenuLevel.tsx"]);

function listComponentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listComponentFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function pickerModules(): Array<{ path: string; source: string }> {
  return listComponentFiles(join(REPOSITORY_ROOT, "assets/ts"))
    .map((path) => ({
      path: relative(REPOSITORY_ROOT, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    }))
    .filter(({ path, source }) => source.includes(POPUP_SURFACE) && !COMMAND_MENUS.has(path));
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}

function excludesSearch(node: ts.Expression): boolean {
  node = unwrap(node);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return ts.isIdentifier(node.operand) && node.operand.text === "searchable";
  }
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
    (excludesSearch(node.left) || excludesSearch(node.right))
  );
}

function nonsearchableBranch(node: ts.Node): boolean {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isConditionalExpression(parent) && child === parent.whenFalse) {
      const condition = unwrap(parent.condition);
      if (ts.isIdentifier(condition) && condition.text === "searchable") return true;
    }
    if (
      ts.isBinaryExpression(parent) &&
      child === parent.right &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      excludesSearch(parent.left)
    )
      return true;
  }
  return false;
}

function searchableButtons(source: string): string[] {
  const file = ts.createSourceFile("picker.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const buttons: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(file) === "Button" &&
      !nonsearchableBranch(node)
    ) {
      buttons.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return buttons;
}

describe("pickers", () => {
  it("permits nonsearchable paging while rejecting buttons reachable during typeahead", () => {
    expect(searchableButtons("const picker = searchable ? <TextInput /> : <Button>Choose</Button>;")).toEqual([]);
    expect(
      searchableButtons("const pager = !searchable && (offset > 0 || hasMore) && <Button>Next options</Button>;"),
    ).toEqual([]);
    expect(searchableButtons("const wrong = searchable && <Button>Run</Button>;")).toHaveLength(1);
    expect(searchableButtons("const wrong = disabled ? <TextInput /> : <Button>Run</Button>;")).toHaveLength(1);
    expect(searchableButtons("const option = <button onClick={() => pick(user)}>User name</button>;")).toEqual([]);
    expect("const search = <button>Search</button>;").toMatch(/>\s*Search\s*</);
    expect(searchableButtons("const wrong = (!searchable || ready) && <Button>Run</Button>;")).toHaveLength(1);
  });
  it("exist — the discovery would otherwise pass by finding nothing", () => {
    expect(pickerModules().map(({ path }) => path).length).toBeGreaterThan(0);
  });

  it.each(pickerModules().map(({ path }) => path))("%s searches as the reader types", (path) => {
    const source = readFileSync(join(REPOSITORY_ROOT, path), "utf8");
    expect(source).toContain('aria-autocomplete="list"');
  });

  it.each(pickerModules().map(({ path }) => path))("%s offers no button to run its search", (path) => {
    const source = readFileSync(join(REPOSITORY_ROOT, path), "utf8");
    // Only structurally gated nonsearchable trigger/paging controls are exempt.
    expect(searchableButtons(source)).toEqual([]);
    expect(source).not.toMatch(/>\s*Search\s*</);
  });
});

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const oxlintBinary = join(repositoryRoot, "node_modules/.bin/oxlint");

type Diagnostic = { code: string; message: string };

let workspace: string;

// The fixtures run against the real .oxlintrc.json, copied beside them, so each
// rule's file scope is tested as well as its selector. Type-aware linting is off
// because the fixtures have no tsconfig and the architecture rules are syntactic.
beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "pkic-oxlint-"));
  const config = JSON.parse(
    readFileSync(join(repositoryRoot, ".oxlintrc.json"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n"),
  ) as { jsPlugins: string[]; options: { typeAware: boolean } };
  config.jsPlugins = [join(repositoryRoot, "scripts/oxlint/pkic-rules.mjs")];
  config.options.typeAware = false;
  writeFileSync(join(workspace, ".oxlintrc.json"), JSON.stringify(config));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// Oxlint exits non-zero when it reports an error; the JSON report is on stdout either way.
function run(path: string): string {
  try {
    return execFileSync(oxlintBinary, ["-c", ".oxlintrc.json", "-f", "json", path], {
      cwd: workspace,
      encoding: "utf8",
    });
  } catch (error) {
    return (error as { stdout: string }).stdout;
  }
}

function lint(path: string, source: string, plugin = "pkic"): Diagnostic[] {
  const file = join(workspace, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const report = JSON.parse(run(path)) as { diagnostics: Diagnostic[] };
  return report.diagnostics.filter((diagnostic) => diagnostic.code.startsWith(`${plugin}(`));
}

const codes = (diagnostics: Diagnostic[]) => diagnostics.map((diagnostic) => diagnostic.code);

describe("Oxlint TypeScript coverage", () => {
  it("reports unreachable code in TypeScript", () => {
    const diagnostics = lint(
      "functions/example.ts",
      "export function example() { return 1; console.log(2); }",
      "eslint",
    );
    expect(codes(diagnostics)).toContain("eslint(no-unreachable)");
  });
});

describe("pkic Oxlint architecture rules", () => {
  describe("API adapters", () => {
    const adapter = "functions/api/example.ts";

    it("flags SQL preparation", () => {
      const diagnostics = lint(adapter, "export const run = (db) => db.prepare('select 1');\n");
      expect(codes(diagnostics)).toEqual(["pkic(no-sql-in-api-adapter)"]);
      expect(diagnostics[0]?.message).toBe(
        "API adapters must not prepare SQL; move the query or mutation into a focused service.",
      );
    });

    it("flags D1 batches", () => {
      const diagnostics = lint(adapter, "export const run = (db) => db.batch([]);\n");
      expect(codes(diagnostics)).toEqual(["pkic(no-d1-batch-in-api-adapter)"]);
      expect(diagnostics[0]?.message).toBe(
        "API adapters must not execute D1 batches; the service must own the complete atomic unit of work.",
      );
    });

    it("flags a literal 405", () => {
      const diagnostics = lint(adapter, "export const status = 405;\n");
      expect(codes(diagnostics)).toEqual(["pkic(no-literal-405)"]);
      expect(diagnostics[0]?.message).toBe(
        "API adapters must use dispatchRequestMethod/dispatchPostOnly so 405 responses and Allow headers stay canonical.",
      );
    });

    it("allows other status codes and calls with other names", () => {
      expect(lint(adapter, "export const status = 404;\nexport const run = (db) => db.exec('x');\n")).toEqual([]);
    });

    it("does not apply outside functions/api", () => {
      const source = "export const status = 405;\nexport const run = (db) => db.prepare('x') && db.batch([]);\n";
      expect(lint("functions/_lib/services/example.ts", source)).toEqual([]);
    });
  });

  describe("portal screens and components", () => {
    const screen = "assets/ts/components/Example.tsx";

    it("flags a literal heading tag at every level", () => {
      const diagnostics = lint(screen, "export const A = () => <div><h1>a</h1><h6>b</h6></div>;\n");
      expect(codes(diagnostics)).toEqual(["pkic(no-literal-heading)", "pkic(no-literal-heading)"]);
      expect(diagnostics[0]?.message).toBe(
        "Use SectionHeading (ui/SectionHeading) or a title primitive so the level follows the screen's heading outline.",
      );
    });

    it("flags an aside inside main", () => {
      const diagnostics = lint(screen, "export const A = () => <aside>a</aside>;\n");
      expect(codes(diagnostics)).toEqual(["pkic(no-aside-in-main)"]);
      expect(diagnostics[0]?.message).toBe(
        "Use a <section> with an accessible name, or a <div> for a layout column, inside main.",
      );
    });

    it("allows components, sections, and headings outside the three portal globs", () => {
      expect(lint(screen, "export const A = () => <div><SectionHeading /><section /></div>;\n")).toEqual([]);
      expect(lint("assets/ts/pages/Example.tsx", "export const A = () => <div><h1>a</h1><aside /></div>;\n")).toEqual(
        [],
      );
    });

    it("covers the sections and live-session globs", () => {
      const source = "export const A = () => <h2>a</h2>;\n";
      expect(codes(lint("assets/ts/member-flows/portal/sections/x/Example.tsx", source))).toEqual([
        "pkic(no-literal-heading)",
      ]);
      expect(codes(lint("assets/ts/live-session/Example.tsx", source))).toEqual(["pkic(no-literal-heading)"]);
    });
  });

  describe("link targets", () => {
    const source =
      "export const A = () => <div><a target='_blank' /><ButtonLink target='_blank' /><ExternalLink target='_self' /></div>;\n";

    it("flags a target on a, ButtonLink, and ExternalLink in screens", () => {
      for (const path of ["assets/ts/components/Example.tsx", "assets/ts/pages/Example.tsx"]) {
        const diagnostics = lint(path, source);
        expect(codes(diagnostics)).toEqual(Array(3).fill("pkic(no-link-target)"));
        expect(diagnostics[0]?.message).toBe(
          "Do not set a link target. Use ExternalLink or ButtonLink so the new-tab policy and its hint stay in one place.",
        );
      }
    });

    it("allows a target on other elements and inside the ui primitives", () => {
      expect(lint("assets/ts/pages/Example.tsx", "export const A = () => <form target='_blank' />;\n")).toEqual([]);
      expect(lint("assets/ts/ui/Example.tsx", source)).toEqual([]);
    });
  });
});

describe("Oxlint frontend and Vitest plugin rules", () => {
  it("checks hook ordering and dependencies in Preact components", () => {
    const source = `import { useEffect, useState } from "preact/hooks";
      export function Example({ value, ready }) {
        if (ready) useState(0);
        useEffect(() => console.log(value), []);
        return null;
      }`;
    expect(codes(lint("assets/ts/pages/Example.tsx", source, "react-hooks"))).toEqual(
      expect.arrayContaining(["react-hooks(rules-of-hooks)", "react-hooks(exhaustive-deps)"]),
    );
  });

  it("checks accessible names, ARIA, and keyboard support in JSX", () => {
    const source = `export const Example = () => <><button /><div aria-invalid="wrong" /><div onClick={() => {}} /></>;`;
    expect(codes(lint("assets/ts/pages/Example.tsx", source, "jsx-a11y"))).toEqual(
      expect.arrayContaining([
        "jsx-a11y(control-has-associated-label)",
        "jsx-a11y(aria-proptypes)",
        "jsx-a11y(click-events-have-key-events)",
      ]),
    );
  });

  it("requires labels to be associated with a control", () => {
    const source = `export const Example = () => <><label>Name</label><label htmlFor="email">Email</label><input id="email" /></>;`;
    expect(codes(lint("assets/ts/pages/Example.tsx", source, "jsx-a11y"))).toEqual([
      "jsx-a11y(label-has-associated-control)",
    ]);
  });

  it("allows table cells, datalist options, and business roles without exempting controls", () => {
    const source = `export const Example = () => <><table><tbody><tr><td /></tr></tbody></table>
      <datalist><option value="example" /></datalist><LivePanel role="operator" /><button /></>;`;
    expect(codes(lint("assets/ts/pages/Example.tsx", source, "jsx-a11y"))).toEqual([
      "jsx-a11y(control-has-associated-label)",
    ]);
  });

  it("checks Vitest assertions, focused tests, and describe callbacks", () => {
    const source = `import { describe, expect, it } from "vitest";
      describe("suite", (unexpected) => {});
      it.only("case", () => { expect(Promise.resolve(1)).resolves.toBe(1); });`;
    expect(codes(lint("tests/example.test.ts", source, "vitest"))).toEqual(
      expect.arrayContaining(["vitest(no-focused-tests)", "vitest(valid-describe-callback)", "vitest(valid-expect)"]),
    );
  });

  it("accepts Vitest assertion messages and excludes Playwright files", () => {
    const source = `import { expect, test } from "vitest";
      test.only("case", () => { expect(1, "context").toBe(1); });`;
    expect(codes(lint("tests/example.test.ts", source, "vitest"))).toEqual(["vitest(no-focused-tests)"]);
    expect(lint("tests/e2e/example.test.ts", source, "vitest")).toEqual([]);
    expect(lint("tests/e2e/example.spec.ts", source, "vitest")).toEqual([]);
  });
});

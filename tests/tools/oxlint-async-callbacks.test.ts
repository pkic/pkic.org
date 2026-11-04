import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("Oxlint async callback contracts", () => {
  it("rejects promises passed to void callbacks while allowing owned promises", () => {
    const workspace = mkdtempSync(join(tmpdir(), "pkic-oxlint-typed-"));
    try {
      const config = JSON.parse(
        readFileSync(join(root, ".oxlintrc.json"), "utf8")
          .split("\n")
          .filter((line) => !line.trim().startsWith("//"))
          .join("\n"),
      ) as { jsPlugins: string[] };
      config.jsPlugins = [join(root, "scripts/oxlint/pkic-rules.mjs")];
      writeFileSync(join(workspace, ".oxlintrc.json"), JSON.stringify(config));
      writeFileSync(
        join(workspace, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true, target: "ES2022", jsx: "preserve" },
          include: ["assets/**/*.tsx"],
        }),
      );
      mkdirSync(join(workspace, "assets/ts"), { recursive: true });
      writeFileSync(
        join(workspace, "assets/ts/example.tsx"),
        `
        declare function Button(props: { onClick: () => void }): unknown;
        declare function acceptsVoid(callback: () => void): void;
        declare function acceptsPromise(callback: () => Promise<void>): Promise<void>;
        declare function report(error: unknown): void;
        declare const work: () => Promise<void>;
        acceptsVoid(async () => { await work(); });
        const props: { action: () => void } = { action: async () => { await work(); } };
        const button = <Button onClick={async () => { await work(); }} />;
        async function valid() { await acceptsPromise(async () => { await work(); }); }
        acceptsVoid(() => { work().catch(report); });
        export { props, button, valid };
      `,
      );
      let output: string;
      try {
        output = execFileSync(
          join(root, "node_modules/.bin/oxlint"),
          ["-c", ".oxlintrc.json", "-f", "json", "assets/ts/example.tsx"],
          { cwd: workspace, encoding: "utf8" },
        );
      } catch (error) {
        output = (error as { stdout: string }).stdout;
      }
      const report = JSON.parse(output) as { diagnostics: { code: string; labels: { span: { line: number } }[] }[] };
      const lines = report.diagnostics
        .filter((diagnostic) => diagnostic.code === "typescript(no-misused-promises)")
        .map((diagnostic) => diagnostic.labels[0]?.span.line);
      expect(lines).toEqual([7, 8, 9]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

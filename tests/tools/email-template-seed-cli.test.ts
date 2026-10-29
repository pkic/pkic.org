import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";
import { rehearsalEnvironment } from "../../scripts/rehearsal/config.mjs";

// Exercise real subprocess spawning at the pnpm boundary without running migrations
// or accessing a database. SQL semantics have their own seed-SQL tests.
describe.skipIf(process.platform === "win32")("email template seed CLI", () => {
  it.each([0, 23])("hands the full catalog to a file and removes it after exit %s", (exitCode) => {
    const directory = mkdtempSync(join(tmpdir(), "pkic-template-cli-test-"));
    const capture = join(directory, "capture.json");
    const payload = join(directory, "payload.sql");
    const executable = join(directory, "pnpm");
    // Isolate the extensionless executable from any ancestor package module type.
    writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "commonjs" }));
    writeFileSync(
      executable,
      `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--json")) {
  fs.writeSync(1, JSON.stringify([{ results: [{ id: "synthetic-admin" }] }]));
} else {
  const file = args[args.indexOf("--file") + 1];
  const sql = fs.readFileSync(file, "utf8");
  fs.writeFileSync(${JSON.stringify(payload)}, sql);
  fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, file, mode: fs.statSync(file).mode & 0o777 }));
  process.exit(${exitCode});
}
`,
      { mode: 0o700 },
    );
    try {
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/seed-email-templates.mjs"), "--local", "--env", "local", "--persist-to", directory],
        {
          encoding: "utf8",
          env: {
            ...rehearsalEnvironment(process.env),
            PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(existsSync(capture), result.stderr).toBe(true);
      const recorded = JSON.parse(readFileSync(capture, "utf8")) as {
        args: string[];
        file: string;
        mode: number;
      };
      const sql = readFileSync(payload, "utf8");
      // Linux limits each individual argument to 128 KiB on a 4 KiB-page host.
      // This catalog exceeds that size and must never travel in argv again.
      expect(Buffer.byteLength(sql)).toBeGreaterThan(128 * 1024);
      for (const template of DEFAULT_TEMPLATES) expect(sql).toContain(`'${template.key}'`);
      expect(recorded.args).not.toContain("--command");
      expect(recorded.mode).toBe(0o600);
      expect(existsSync(dirname(recorded.file))).toBe(false);
      if (exitCode === 0) {
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(`Seeded ${DEFAULT_TEMPLATES.length} email template(s)`);
      } else {
        expect(result.status).not.toBe(0);
        expect(result.stdout).not.toContain("Seeded");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

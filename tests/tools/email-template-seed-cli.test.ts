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
  it.each(["ready", "missing", "legacy-storage", "latest-empty"])("checks %s templates without writing", (state) => {
    const directory = mkdtempSync(join(tmpdir(), "pkic-template-check-"));
    const capture = join(directory, "arguments.json");
    const key = "registration_email_verify";
    const rows =
      state === "missing"
        ? []
        : [
            { key, version: 1, body: state === "legacy-storage" ? "" : "Verify your address", r2: "legacy.html" },
            ...(state === "latest-empty" ? [{ key, version: 2, body: "", r2: null }] : []),
          ];
    writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "commonjs" }));
    writeFileSync(
      join(directory, "pnpm"),
      `#!${process.execPath}
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(args));
if (args.includes("--file")) process.exit(90);
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE email_template_versions(template_key TEXT, version INTEGER, body TEXT, status TEXT, r2_object_key TEXT)");
for (const row of ${JSON.stringify(rows)}) db.prepare("INSERT INTO email_template_versions VALUES (?, ?, ?, 'active', ?)").run(row.key, row.version, row.body, row.r2);
const query = args[args.indexOf("--command") + 1];
fs.writeSync(1, JSON.stringify([{ results: db.prepare(query).all() }]));
`,
      { mode: 0o700 },
    );
    try {
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/seed-email-templates.mjs"), "--check", "--only-template", key, "--local", "--env", "local"],
        {
          encoding: "utf8",
          env: { ...rehearsalEnvironment(process.env), PATH: `${directory}${delimiter}${process.env.PATH ?? ""}` },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(state === "ready" ? 0 : 1);
      const args: string[] = JSON.parse(readFileSync(capture, "utf8"));
      expect(args).toContain("--local");
      expect(args).not.toContain("--file");
      if (state === "ready") expect(result.stdout).toContain("All 1 catalog email template");
      else expect(result.stderr).toContain(key);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

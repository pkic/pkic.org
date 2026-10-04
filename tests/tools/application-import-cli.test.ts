import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existingReport,
  lockReport,
  privatePaths,
  readJson,
  writeReport,
} from "../../scripts/membership-application-import/files.mjs";
import {
  applicationBackfillSql,
  sourceId,
  confirmationQuery,
} from "../../scripts/membership-application-import/sql.mjs";
import { runCommand } from "../../scripts/membership-application-import/process.mjs";
import { actorId, reviewedManifest, parsedReviewedManifest } from "./helpers/application-import-fixtures";

const exec = promisify(execFile);
let directory: string;
let localDirectory: string;
async function wrangler(args: string[]) {
  const { stdout } = await exec("pnpm", ["exec", "wrangler", ...args], {
    cwd: resolve("."),
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}
async function query(sql: string) {
  const output = await wrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    "local",
    "--local",
    "--persist-to",
    localDirectory,
    "--json",
    "--command",
    sql,
  ]);
  return JSON.parse(output) as { results: Record<string, unknown>[] }[];
}
async function sqlFile(sql: string) {
  const path = join(directory, "fixture.sql");
  await writeFile(path, sql, { mode: 0o600 });
  return wrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    "local",
    "--local",
    "--persist-to",
    localDirectory,
    "--json",
    "--file",
    path,
  ]);
}
async function cli(args: string[]) {
  try {
    const { stdout } = await exec(process.execPath, ["scripts/import-membership-applications.mjs", ...args], {
      cwd: resolve("."),
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, output: `${failed.stdout}${failed.stderr}` };
  }
}
beforeAll(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "application-backfill-")));
  localDirectory = join(directory, "database");
  await mkdir(localDirectory);
  await wrangler(["d1", "migrations", "apply", "DB", "--env", "local", "--local", "--persist-to", localDirectory]);
  await query(
    `INSERT INTO users (id, email, normalized_email, created_at, updated_at) VALUES ('${actorId}', 'reviewer@example.org', 'reviewer@example.org', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  );
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("private backfill files", () => {
  it("preserves Unicode split across subprocess output chunks", async () => {
    const output = await runCommand(
      process.execPath,
      [
        "-e",
        "process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 20)",
      ],
      new AbortController().signal,
    );
    expect(output).toBe("é");
  });

  it("protects atomic report writes, exclusive locks, and private permissions", async () => {
    const path = join(directory, "storage.json");
    expect(await existingReport(path)).toBeUndefined();
    const unlock = await lockReport(path);
    await expect(lockReport(path)).rejects.toThrow("locked");
    await writeReport(path, { version: 2 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readJson(path)).toEqual({ version: 2 });
    await unlock();
  });
  it("rejects repository output, symlink reports, and overwriting input", async () => {
    const manifest = join(directory, "paths.json");
    await writeFile(manifest, "{}");
    await expect(privatePaths(manifest, resolve("results.json"), resolve("."))).rejects.toThrow("outside");
    await expect(privatePaths(manifest, manifest, resolve("."))).rejects.toThrow("different");
    const link = join(directory, "link.json");
    await symlink(manifest, link);
    await expect(privatePaths(manifest, link, resolve("."))).rejects.toThrow("symlink");
  });
  it("terminates an operational subprocess when interrupted", async () => {
    const controller = new AbortController();
    const result = runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], controller.signal);
    const timer = setTimeout(() => controller.abort(), 200);
    try {
      await expect(result).rejects.toThrow("Operational command failed");
    } finally {
      clearTimeout(timer);
    }
  });
});

describe("backfill against the unchanged D1 schema", () => {
  it("defaults to offline validation, refuses overwrite and old reports, and reports unsupported records", async () => {
    const input = reviewedManifest(localDirectory);
    input.entries[1].source.issue.state = "open";
    const manifest = join(directory, "dry-manifest.json");
    const report = join(directory, "dry.json");
    await writeFile(manifest, JSON.stringify(input));
    const args = ["--manifest", manifest, "--report", report];
    const dry = await cli(args);
    expect(dry.code, dry.output).toBe(2);
    expect(await readJson(report)).toMatchObject({ mode: "dry-run", summary: { ready: 1, unresolved: 1 } });
    expect((await cli(args)).code).toBe(1);
    expect((await cli([...args, "--execute", "--resume"])).code).toBe(1);
    await writeFile(report, "null");
    expect((await cli(args)).code).toBe(1);
    expect(await readFile(report, "utf8")).toBe("null");
    expect((await query("SELECT count(*) AS n FROM member_applications"))[0].results[0].n).toBe(0);
  });
  it("executes the real CLI, preserves original evidence, and resumes without schema or onboarding changes", async () => {
    const input = reviewedManifest(localDirectory);
    const manifest = join(directory, "reviewed.json");
    const report = join(directory, "results.json");
    await writeFile(manifest, JSON.stringify(input));
    const args = ["--manifest", manifest, "--report", report, "--execute"];
    const result = await cli(args);
    expect(result.code, result.output).toBe(0);
    expect(await readJson(report)).toMatchObject({ summary: { imported: 2 }, phase: "complete" });
    expect((await cli([...args, "--resume"])).code).toBe(0);
    const rows =
      await query(`SELECT id, stage, stage_entered_at, organization_domain, form_submission_id FROM member_applications;
      SELECT body, created_at FROM application_communications ORDER BY created_at;
      SELECT count(*) AS n FROM email_outbox; SELECT count(*) AS n FROM members;
      SELECT count(*) AS n FROM users; SELECT count(*) AS n FROM membership_application_workflows;
      SELECT name FROM sqlite_master WHERE name LIKE 'membership_application_import%' OR name = 'membership_application_sources';`);
    expect(rows[0].results).toHaveLength(2);
    expect(rows[0].results[0]).toMatchObject({
      stage: "declined",
      stage_entered_at: "2020-01-02T00:00:00.000Z",
      form_submission_id: null,
      organization_domain: "example.org",
    });
    expect(JSON.stringify(rows[1].results)).toContain("Example User's application; consent was not recorded");
    expect(JSON.stringify(rows[1].results)).toContain("example-reviewer");
    expect(rows[2].results[0].n).toBe(0);
    expect(rows[3].results[0].n).toBe(0);
    expect(rows[4].results[0].n).toBe(1);
    expect(rows[5].results[0].n).toBe(0);
    expect(rows[6].results).toEqual([]);
  });

  it("records approved and withdrawn history without provisioning or workflow side effects", async () => {
    const input = parsedReviewedManifest(localDirectory);
    for (const [index, outcome] of ["approved", "withdrawn"].entries()) {
      const entry = structuredClone(input.entries[0]);
      entry.source.issue.id = 400 + index;
      entry.mapping.applicantEmail = `terminal${index}@example.org`;
      entry.mapping.outcome = outcome;
      entry.mapping.mappingReason = `The source explicitly records that the application was ${outcome}.`;
      entry.source.comments[0].body = entry.mapping.mappingReason;
      await sqlFile(applicationBackfillSql(input, entry));
    }
    const rows = await query(
      "SELECT stage FROM member_applications WHERE applicant_email LIKE 'terminal%@example.org' ORDER BY stage; SELECT count(*) AS n FROM email_outbox; SELECT count(*) AS n FROM members; SELECT count(*) AS n FROM membership_application_workflows",
    );
    expect(rows[0].results).toEqual([{ stage: "approved" }, { stage: "withdrawn" }]);
    for (const result of rows.slice(1)) expect(result.results[0].n).toBe(0);
  });

  it("replaying SQL preserves later portal edits and does not duplicate notes or audit events", async () => {
    const input = parsedReviewedManifest(localDirectory);
    const entry = input.entries[0];
    const id = sourceId(entry.source);
    await query(`UPDATE member_applications SET applicant_name = 'Later portal edit' WHERE id = '${id}'`);
    const before = await query(
      "SELECT count(*) AS n FROM application_communications; SELECT count(*) AS n FROM audit_log",
    );
    await sqlFile(applicationBackfillSql(input, entry));
    const after = await query(
      `SELECT count(*) AS n FROM application_communications; SELECT count(*) AS n FROM audit_log; SELECT applicant_name FROM member_applications WHERE id = '${id}'`,
    );
    expect(after.slice(0, 2).map((result) => result.results)).toEqual(before.map((result) => result.results));
    expect(after[2].results[0].applicant_name).toBe("Later portal edit");
    const manifest = join(directory, "reviewed.json");
    const report = join(directory, "repeat.json");
    expect((await cli(["--manifest", manifest, "--report", report, "--execute"])).code).toBe(0);
    expect(await readJson(report)).toMatchObject({ summary: { already_present: 2 } });
  });
  it("rolls back application, notes, and audit on a late constraint failure", async () => {
    const input = parsedReviewedManifest(localDirectory);
    const entry = input.entries[0];
    entry.source.issue.id = 999;
    entry.mapping.applicantEmail = "rollback@example.org";
    const sql =
      applicationBackfillSql(input, entry) +
      `\nINSERT INTO application_communications (id, application_id, kind, actor_user_id, body, created_at) VALUES ('bad', 'missing', 'note', '${actorId}', 'failure', '2026-01-01T00:00:00.000Z');`;
    await expect(sqlFile(sql)).rejects.toThrow();
    const result = await query(
      `${confirmationQuery(entry.source)}; SELECT count(*) AS n FROM application_communications WHERE application_id = '${sourceId(entry.source)}'; SELECT count(*) AS n FROM audit_log WHERE entity_id = '${sourceId(entry.source)}'`,
    );
    expect(result[0].results).toEqual([]);
    expect(result[1].results[0].n).toBe(0);
    expect(result[2].results[0].n).toBe(0);
  });
  it("refuses an existing application match and an invalid linked user without partial records", async () => {
    const input = parsedReviewedManifest(localDirectory);
    const entry = input.entries[0];
    entry.source.issue.id = 1000;
    await expect(sqlFile(applicationBackfillSql(input, entry))).rejects.toThrow();
    entry.mapping.applicantEmail = "unmatched@example.org";
    entry.mapping.applicantUserId = actorId;
    await expect(sqlFile(applicationBackfillSql(input, entry))).rejects.toThrow();
    expect((await query(confirmationQuery(entry.source)))[0].results).toEqual([]);
  });
});

import { applicationBackfillFixture } from "../helpers/application-backfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../scripts/membership-application-import/process.mjs";
import { ImportCommandError, logImportFailure } from "../../scripts/membership-application-import/diagnostics.mjs";
import { importEntry } from "../../scripts/membership-application-import/database.mjs";
import { createReport, executeBatch, resumeReport } from "../../scripts/membership-application-import/batch.mjs";
import { runCli } from "../../scripts/membership-application-import/cli.mjs";
import ts from "typescript";
import { sourceId } from "../../scripts/membership-application-import/sql.mjs";
import { utcInstantSchema } from "../../assets/shared/schemas/api-common";
import { databaseIdSchema } from "../../assets/shared/schemas/identifiers";

let directory: string;
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "application-import-diagnostics-"));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

function failure(error: unknown) {
  return { error, phase: "write_application", status: "uncertain", sourceIssueNumber: 123, timeoutMs: 120_000 };
}

async function record(error: unknown) {
  const path = join(directory, "execution.json.diagnostics.jsonl");
  await logImportFailure(path, failure(error));
  return JSON.parse((await readFile(path, "utf8")).trim().split("\n").at(-1)!);
}

function fixture() {
  return applicationBackfillFixture(directory);
}

it("captures a real command's stderr and exit code without echoing private output", async () => {
  const error = await runCommand(
    process.execPath,
    ["-e", "console.error('FOREIGN KEY constraint failed; user@example.org'); process.exit(7)"],
    new AbortController().signal,
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(ImportCommandError);
  expect(String(error)).not.toContain("user@example.org");
  const diagnostic = await record(error);
  expect(diagnostic).toMatchObject({ exitCode: 7, kind: "exit", phase: "write_application" });
  expect(diagnostic.stderr).toContain("user@example.org");
  expect(JSON.stringify(consoleError.mock.calls)).toContain("FOREIGN KEY constraint failed");
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain("user@example.org");
  expect((await stat(join(directory, "execution.json.diagnostics.jsonl"))).mode & 0o777).toBe(0o600);
});

it("distinguishes a missing executable from a command exit", async () => {
  const error = await runCommand(join(directory, "missing-command"), [], new AbortController().signal).catch(
    (cause: unknown) => cause,
  );
  expect(await record(error)).toMatchObject({ kind: "spawn", systemCode: "ENOENT" });
  expect(JSON.stringify(consoleError.mock.calls)).toContain("ENOENT");
});

it("distinguishes a per-source timeout from an operator interruption", async () => {
  const error = await runCommand(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    AbortSignal.timeout(100),
  ).catch((cause: unknown) => cause);
  expect(await record(error)).toMatchObject({ kind: "timeout" });
  expect(JSON.stringify(consoleError.mock.calls)).toContain("timeout expired");
  const controller = new AbortController();
  controller.abort();
  const interrupted = await runCommand(process.execPath, [], controller.signal).catch((cause: unknown) => cause);
  expect(await record(interrupted)).toMatchObject({ kind: "interrupted" });
});

it("omits SQL arguments and redacts credentials while retaining the useful error", async () => {
  const path = join(directory, "diagnostics.jsonl");
  await logImportFailure(
    path,
    failure(
      new ImportCommandError({
        kind: "exit",
        command: "pnpm",
        args: ["exec", "wrangler", "--command", "SELECT 'private applicant'", "--file", "/private/application.sql"],
        exitCode: 1,
        stdout: "",
        stderr:
          "no such table: member_applications\nBearer secret-header-value\nghp_synthetic_token\nenvironment-secret",
      }),
    ),
    { CLOUDFLARE_API_TOKEN: "environment-secret" },
  );
  const text = await readFile(path, "utf8");
  expect(text).toContain("no such table: member_applications");
  for (const privateValue of [
    "private applicant",
    "/private/application.sql",
    "secret-header-value",
    "ghp_synthetic_token",
    "environment-secret",
  ])
    expect(text).not.toContain(privateValue);
});

it("refuses a symlink diagnostic file and still reports the original failure", async () => {
  const target = join(directory, "target");
  await writeFile(target, "keep this content");
  const path = join(directory, "diagnostics.jsonl");
  await symlink(target, path);
  await logImportFailure(path, failure(new Error("Synthetic failure")));
  expect(await readFile(target, "utf8")).toBe("keep this content");
  expect(JSON.stringify(consoleError.mock.calls)).toContain("Could not write private diagnostics");
});

it("shows the command output limit instead of a generic operational error", async () => {
  const error = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024)); setInterval(() => {}, 1000)"],
    AbortSignal.timeout(10_000),
  ).catch((cause: unknown) => cause);
  const diagnostic = await record(error);
  expect(diagnostic.kind).toBe("output_limit");
  expect(diagnostic.stdout.length).toBeLessThanOrEqual(4 * 1024 * 1024);
});

describe("failure phases and resume", () => {
  it.each(["check_existing", "write_application", "confirm_application"])(
    "logs %s while preserving write uncertainty",
    async (phase) => {
      const input = fixture();
      let calls = 0;
      const onFailure = vi.fn(async () => {});
      const command = vi.fn(async () => {
        calls++;
        if (calls === ["check_existing", "write_application", "confirm_application"].indexOf(phase) + 1)
          throw new ImportCommandError({
            kind: "exit",
            command: "pnpm",
            args: [],
            stdout: "",
            stderr: "SQLITE_ERROR",
            exitCode: 1,
          });
        return JSON.stringify([{ success: true, results: [] }]);
      });
      const result = await importEntry({ ...input, command, onFailure });
      expect(result).toMatchObject({
        status: phase === "check_existing" ? "failed" : "uncertain",
        error: "operational_command",
        stop: true,
      });
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ phase, sourceIssueNumber: 123 }));
    },
  );

  it("routes GitHub failures through the same diagnostic command runner", async () => {
    const input = fixture();
    input.manifest.sourceData = "private";
    const command = vi.fn(async () => {
      throw new Error("Synthetic gh failure");
    });
    const onFailure = vi.fn(async () => {});
    const result = await importEntry({ ...input, command, onFailure });
    expect(result.status).toBe("failed");
    expect(command).toHaveBeenCalledWith("gh", expect.any(Array), expect.any(AbortSignal));
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ phase: "read_source" }));
  });

  it("keeps diagnostic details outside reports and reconciles a committed uncertain write on resume", async () => {
    const input = fixture();
    const contracts = { utcInstantSchema, databaseIdSchema };
    const report = createReport(input.manifest, contracts, true);
    const onFailure = vi.fn(async () => {});
    let calls = 0;
    await executeBatch({
      manifest: input.manifest,
      report,
      directory,
      signal: input.signal,
      save: async () => {},
      onFailure,
      performImport: (options) =>
        importEntry({
          ...options,
          command: async () => {
            if (++calls === 2) throw new Error("Synthetic lost write response");
            return JSON.stringify([{ success: true, results: [] }]);
          },
        }),
    });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(JSON.stringify(report)).not.toContain("Synthetic lost write response");
    const resumed = resumeReport(JSON.parse(JSON.stringify(report)), input.manifest, contracts);
    const command = vi.fn(async () =>
      JSON.stringify([{ success: true, results: [{ id: sourceId(input.entry.source), source_note: 1 }] }]),
    );
    expect(
      await executeBatch({
        manifest: input.manifest,
        report: resumed,
        directory,
        signal: input.signal,
        save: async () => {},
        performImport: (options) => importEntry({ ...options, command }),
      }),
    ).toBe(0);
    expect(resumed.entries[0].status).toBe("already_present");
    expect(command).toHaveBeenCalledOnce();
  });
});

it("connects CLI execution failures to the private diagnostic file without accessing GitHub or D1", async () => {
  const input = fixture();
  input.manifest.sourceData = "private";
  const config = ts.parseConfigFileTextToJson("wrangler.jsonc", await readFile("wrangler.jsonc", "utf8"));
  input.manifest.databaseId = config.config.env.local.d1_databases.find(
    (binding: { binding: string }) => binding.binding === "DB",
  ).database_id;
  const manifestPath = join(directory, "manifest.json");
  const reportPath = join(directory, "execution.json");
  await writeFile(manifestPath, JSON.stringify(input.manifest), { mode: 0o600 });
  await writeFile(join(directory, "gh"), "#!/bin/sh\necho 'HTTP 401: synthetic authentication failure' >&2\nexit 5\n", {
    mode: 0o700,
  });
  vi.stubEnv("PATH", `${directory}:${process.env.PATH}`);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await runCli(["--manifest", manifestPath, "--report", reportPath, "--execute"])).toBe(2);
    const diagnostic = JSON.parse((await readFile(`${reportPath}.diagnostics.jsonl`, "utf8")).trim());
    expect(diagnostic).toMatchObject({ phase: "read_source", command: "gh", exitCode: 5, status: "failed" });
    expect(diagnostic.stderr).toContain("synthetic authentication failure");
    expect(JSON.stringify(consoleError.mock.calls)).toContain("HTTP 401");
    expect(JSON.stringify(consoleError.mock.calls)).toContain(`${reportPath}.diagnostics.jsonl`);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.entries[0]).toMatchObject({ status: "failed", error: "operational_command" });
    expect(JSON.stringify(report)).not.toContain("synthetic authentication failure");
  } finally {
    vi.unstubAllEnvs();
    log.mockRestore();
  }
});

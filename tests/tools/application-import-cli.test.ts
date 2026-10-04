import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, stat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  existingReport,
  lockReport,
  privatePaths,
  readJson,
  writeReport,
} from "../../scripts/membership-application-import/files.mjs";
import { contracts, resultId, reviewedManifest } from "./helpers/application-import-fixtures";

const directories: string[] = [];
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), "pkic-application-cli-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function cli(args: string[], token = "", onSpawn: (child: ChildProcess) => void = () => {}) {
  return new Promise<{ code: number | null; output: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, ["scripts/import-membership-applications.mjs", ...args], {
      cwd: resolve("."),
      env: { ...process.env, PKIC_PORTAL_SESSION_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    onSpawn(child);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code, output }));
  });
}

describe("private report storage", () => {
  it("writes atomic private JSON and prevents concurrent execution", async () => {
    const path = join(await workspace(), "report.json");
    expect(await existingReport(path)).toBeUndefined();
    const unlock = await lockReport(path);
    await expect(lockReport(path)).rejects.toThrow("locked");
    expect((await stat(`${path}.lock`)).mode & 0o777).toBe(0o600);
    await writeReport(path, { version: 1 });
    await writeReport(path, { version: 2 });
    expect(await readJson(path)).toEqual({ version: 2 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await unlock();
    await (
      await lockReport(path)
    )();
  });
  it("rejects repository paths, symlink reports, and overwriting the manifest", async () => {
    const dir = await workspace();
    const manifest = join(dir, "manifest.json");
    await writeFile(manifest, "{}");
    await expect(privatePaths(manifest, resolve("results.json"), resolve("."))).rejects.toThrow("outside");
    await expect(privatePaths(resolve("package.json"), join(dir, "report.json"), resolve("."))).rejects.toThrow(
      "outside",
    );
    await expect(privatePaths(manifest, manifest, resolve("."))).rejects.toThrow("different");
    const link = join(dir, "link.json");
    await symlink(manifest, link);
    await expect(privatePaths(manifest, link, resolve("."))).rejects.toThrow("symlink");
    await expect(readJson(link)).rejects.toThrow();
  });
  it("does not leak malformed JSON contents", async () => {
    const path = join(await workspace(), "invalid.json");
    await writeFile(path, '{"privateUser": SECRET');
    await expect(readJson(path)).rejects.toThrow(/^Input is not valid JSON$/);
  });
});

describe("real batch CLI", () => {
  it.each(["SIGINT", "timeout"])("checkpoints a real %s during HTTP and resumes", async (failure) => {
    let interrupt = () => {};
    let interrupted = true;
    const server = createServer((request, response) => {
      request.resume();
      if (interrupted) {
        if (failure === "SIGINT") interrupt();
      } else response.end(JSON.stringify({ id: resultId, imported: false }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const dir = await workspace();
      const manifest = join(dir, "manifest.json");
      const report = join(dir, "results.json");
      await writeFile(manifest, JSON.stringify(reviewedManifest(`http://127.0.0.1:${address.port}`)));
      const args = ["--manifest", manifest, "--report", report, "--execute", "--timeout-seconds", "1"];
      const first = await cli(args, "synthetic-session", (child) => {
        interrupt = () => {
          child.kill("SIGINT");
        };
      });
      expect(first.code, first.output).toBe(failure === "SIGINT" ? 130 : 2);
      expect(await readJson(report)).toMatchObject({ summary: { uncertain: 1, pending: 1 } });
      interrupted = false;
      const resumed = await cli([...args, "--resume"], "synthetic-session");
      expect(resumed.code, resumed.output).toBe(0);
      expect(await readJson(report)).toMatchObject({ summary: { already_present: 2 } });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("defaults to offline validation, protects existing reports, and requires execution credentials", async () => {
    const dir = await workspace();
    const manifest = join(dir, "manifest.json");
    const report = join(dir, "dry-run.json");
    await writeFile(manifest, JSON.stringify(reviewedManifest()));
    const args = ["--manifest", manifest, "--report", report];
    const dry = await cli([...args, "--dry-run"]);
    expect(dry.code, dry.output).toBe(0);
    expect((await cli([...args, "--dry-run", "--execute"])).code).toBe(1);
    expect(await readJson(report)).toMatchObject({ mode: "dry-run", summary: { ready: 2 } });
    expect(dry.output).toContain("Offline validation only");
    expect(dry.output).not.toContain("Example User");
    const before = await readFile(report, "utf8");
    expect((await cli(args)).code).toBe(1);
    expect(await readFile(report, "utf8")).toBe(before);
    await writeFile(report, "null");
    expect((await cli(args)).code).toBe(1);
    expect(await readFile(report, "utf8")).toBe("null");
    await writeFile(report, before);
    const missingToken = await cli([...args, "--execute"]);
    expect(missingToken.code).toBe(1);
    expect(missingToken.output).toContain("PKIC_PORTAL_SESSION_TOKEN");
    expect((await cli([...args, "--execute", "--resume"], "synthetic-session")).code).toBe(1);
  });
  it("executes synthetic imports over HTTP, stops on uncertainty, and resumes without repeating success", async () => {
    const requests: number[] = [];
    let failSecond = true;
    const server = createServer(async (request, response) => {
      expect(request.url).toBe("/api/v1/members/applications/imports");
      expect(request.headers.authorization).toBe("Bearer synthetic-session");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = contracts.membershipApplicationImportRequestSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      requests.push(body.sourceIssueNumber);
      if (body.sourceIssueNumber === 2 && failSecond) {
        response.writeHead(503).end("Private error details");
      } else {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ id: resultId, imported: true }));
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const dir = await workspace();
      const manifest = join(dir, "manifest.json");
      const report = join(dir, "results.json");
      await writeFile(manifest, JSON.stringify(reviewedManifest(`http://127.0.0.1:${address.port}`)));
      const args = ["--manifest", manifest, "--report", report, "--execute"];
      const first = await cli(args, "synthetic-session");
      expect(first.code, first.output).toBe(2);
      expect(requests).toEqual([1, 2]);
      expect(await readJson(report)).toMatchObject({ phase: "incomplete", summary: { imported: 1, uncertain: 1 } });
      failSecond = false;
      const resumed = await cli([...args, "--resume"], "synthetic-session");
      expect(resumed.code, resumed.output).toBe(0);
      expect(requests).toEqual([1, 2, 2]);
      expect(await readJson(report)).toMatchObject({ phase: "complete", summary: { imported: 2 } });
      expect(await readFile(report, "utf8")).not.toMatch(/Private error|synthetic-session|Example User/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

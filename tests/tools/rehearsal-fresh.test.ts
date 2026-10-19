import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { FRESH_STATE_DIRECTORY, parseRehearsalOptions } from "../../scripts/rehearsal/options.mjs";
import {
  FRESH_ADMIN_EMAIL,
  assertPortAvailable,
  freshFixtureFiles,
  freshSeedArguments,
  freshStartupSummary,
  missingPrerequisite,
  prepareFreshState,
  resetFreshState,
  writeFreshManifest,
} from "../../scripts/rehearsal/fresh.mjs";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "rehearsal-fresh-"));
  directories.push(directory);
  return directory;
}

describe("synthetic local test environment", () => {
  it("defaults to the ignored repository state directory and accepts reset and ports", () => {
    const defaults = parseRehearsalOptions(["fresh"]);
    expect(defaults).toMatchObject({
      command: "fresh",
      reset: false,
      state: path.resolve(FRESH_STATE_DIRECTORY),
      port: 8788,
      inboxPort: 8799,
    });
    expect(readFileSync(".gitignore", "utf8")).toContain(`/${FRESH_STATE_DIRECTORY}/`);
    const options = parseRehearsalOptions(["fresh", "--", "--reset", "--port", "8798", "--inbox-port", "8819"]);
    expect(options).toMatchObject({ reset: true, port: 8798, inboxPort: 8819 });
    expect(parseRehearsalOptions(["fresh", "--state", "other"]).state).toBe(path.resolve("other"));
  });

  it("refuses production dumps, reset outside fresh, and colliding ports", () => {
    expect(() => parseRehearsalOptions(["fresh", "--dump", "backup.sql"])).toThrow("Only init accepts --dump");
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--reset"])).toThrow(
      "Only fresh accepts --reset",
    );
    expect(() => parseRehearsalOptions(["fresh", "--port", "8799"])).toThrow("differ");
    expect(
      parseRehearsalOptions(["fresh", "--host", "0.0.0.0", "--base-url", "http://10.0.52.217:8788"]),
    ).toMatchObject({
      host: "0.0.0.0",
      baseUrl: "http://10.0.52.217:8788",
    });
    expect(() => parseRehearsalOptions(["fresh", "--base-url", "https://example.test/path"])).toThrow("origin");
    expect(() => parseRehearsalOptions(["fresh", "--help"])).toThrow("pnpm dev:test");
  });

  it("creates the state once with a local secret and reuses it after setup finishes", () => {
    const state = path.join(temporaryDirectory(), "nested", "state");
    const created = prepareFreshState(state);
    expect(created.created).toBe(true);
    expect(created.manifest).toMatchObject({ mode: "fresh", ready: false });
    expect(created.manifest.signingSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(() => prepareFreshState(state)).toThrow("pnpm dev:test --reset");
    writeFreshManifest(state, { ...created.manifest, ready: true });
    const reused = prepareFreshState(state);
    expect(reused).toEqual({ created: false, manifest: { ...created.manifest, ready: true } });
  });

  it("never reuses or resets a dump rehearsal or an unrelated directory", () => {
    const dump = temporaryDirectory();
    writeFileSync(path.join(dump, "rehearsal.json"), JSON.stringify({ ready: true, signingSecret: "x" }));
    expect(() => prepareFreshState(dump)).toThrow("dump-based rehearsal");
    expect(() => resetFreshState(dump)).toThrow("Refusing to reset");
    expect(existsSync(path.join(dump, "rehearsal.json"))).toBe(true);

    const unrelated = temporaryDirectory();
    writeFileSync(path.join(unrelated, "notes.txt"), "keep");
    expect(() => prepareFreshState(unrelated)).toThrow("not empty");
    expect(() => resetFreshState(unrelated)).toThrow("Refusing to reset");

    const fresh = path.join(temporaryDirectory(), "state");
    prepareFreshState(fresh);
    resetFreshState(fresh);
    expect(existsSync(fresh)).toBe(false);
    expect(() => resetFreshState(fresh)).not.toThrow();
  });

  it("seeds only local synthetic data into the isolated state", () => {
    const state = "/local/test";
    expect(freshSeedArguments(state)).toEqual([
      "scripts/seed.mjs",
      "--local",
      "--skip-migrations",
      "--persist-to",
      state,
    ]);
    const [fixture] = freshFixtureFiles(process.cwd());
    expect(existsSync(fixture)).toBe(true);
    expect(path.relative(process.cwd(), fixture)).toBe(path.join("tests", "fixtures", "e2e-settings.sql"));
  });

  it("names the command that fixes a missing installation", () => {
    expect(missingPrerequisite(process.cwd())).toBeNull();
    const root = temporaryDirectory();
    expect(missingPrerequisite(root)).toContain("pnpm install");
    mkdirSync(path.join(root, "node_modules/wrangler/bin"), { recursive: true });
    writeFileSync(path.join(root, "node_modules/wrangler/bin/wrangler.js"), "");
    expect(missingPrerequisite(root)).toContain("pnpm install");
  });

  it("reports a busy port with the option that changes it", async () => {
    const server: Server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No server address");
      await expect(assertPortAvailable(address.port, "--inbox-port")).rejects.toThrow(
        `Port ${address.port} is already in use. Stop the other server or pass --inbox-port <port>.`,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("prints where to go and how to sign in without any secret", () => {
    const summary = freshStartupSummary({ port: 8798, inboxPort: 8819, state: "/local/test" });
    expect(summary).toContain("http://localhost:8798/portal/");
    expect(summary).toContain("http://127.0.0.1:8819/");
    expect(summary).toContain(FRESH_ADMIN_EMAIL);
    expect(summary).toContain("pnpm dev:test --reset");
    expect(summary).not.toMatch(/[a-f0-9]{64}/);
  });
});

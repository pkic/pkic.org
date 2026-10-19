/**
 * The Worker suite's per-run site build lives in a temporary directory of its
 * own. These runs replace the real Astro build with a synthetic checkout whose
 * build script only records its process and waits, so each test proves the
 * directory and the build are gone after a failure, an exit, a stop signal, or
 * a run that was killed outright.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STATIC_PUBLICATION_FIXTURE_PREFIX,
  prepareStaticPublicationFixture,
  removeAbandonedStaticPublicationFixtures,
} from "../helpers/prepare-static-publication.mjs";

const HELPER = resolve(import.meta.dirname, "../helpers/prepare-static-publication.mjs");
const scratch: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A checkout whose `build:astro` records its pid, then fails or waits. */
function synthetic(build: "fail" | "wait") {
  const root = mkdtempSync(join(process.env.PKIC_BUILD_TMPDIR || tmpdir(), "pkic-fixture-cleanup-test-"));
  scratch.push(root);
  const checkout = join(root, "checkout");
  const fixtures = join(root, "fixtures");
  mkdirSync(checkout);
  writeFileSync(join(checkout, "package.json"), JSON.stringify({ scripts: { "build:astro": "node build.cjs" } }));
  writeFileSync(
    join(checkout, "build.cjs"),
    `require("node:fs").writeFileSync("build.pid", String(process.pid));\n` +
      (build === "fail" ? "process.exit(1);\n" : "setTimeout(() => {}, 120000);\n"),
  );
  const env = {
    ...process.env,
    PKIC_BUILD_TMPDIR: fixtures,
    PKIC_PUBLICATION_CACHE_ROOT: join(root, "no-shared-cache"),
  };
  return { checkout, fixtures, env, pidFile: join(checkout, "build.pid") };
}

const fixtureDirectories = (fixtures: string) =>
  existsSync(fixtures)
    ? readdirSync(fixtures).filter((name) => name.startsWith(STATIC_PUBLICATION_FIXTURE_PREFIX))
    : [];

/** A separate Node process that prepares the fixture, optionally exiting once the build is running. */
function runner(checkout: string, env: NodeJS.ProcessEnv, exitWhenBuilding: boolean): ChildProcess {
  const script = `
    import { existsSync } from "node:fs";
    import { prepareStaticPublicationFixture } from ${JSON.stringify(HELPER)};
    prepareStaticPublicationFixture(${JSON.stringify(checkout)}).catch(() => {});
    ${exitWhenBuilding ? `setInterval(() => { if (existsSync(${JSON.stringify(join(checkout, "build.pid"))})) process.exit(0); }, 50);` : ""}
  `;
  return spawn(process.execPath, ["--input-type=module", "-e", script], { env, stdio: "ignore" });
}

/** Stop the run once its build is under way (or let it exit by itself), then nothing of it may remain. */
async function stopsCleanly(child: ChildProcess, fixtures: string, pidFile: string, stop?: NodeJS.Signals) {
  const exited = once(child, "exit");
  if (stop) {
    await vi.waitFor(
      () => {
        expect(existsSync(pidFile)).toBe(true);
        expect(fixtureDirectories(fixtures)).toHaveLength(1);
      },
      { timeout: 60_000, interval: 100 },
    );
    child.kill(stop);
  }
  const [code, signal] = await exited;
  expect(existsSync(pidFile)).toBe(true);
  expect(fixtureDirectories(fixtures)).toEqual([]);
  const build = Number(readFileSync(pidFile, "utf8"));
  await vi.waitFor(() => expect(alive(build)).toBe(false), { timeout: 10_000, interval: 50 });
  return { code, signal };
}

describe("Worker static publication fixture cleanup", () => {
  it("removes its directory when the build fails", async () => {
    const { checkout, fixtures, env } = synthetic("fail");
    vi.stubEnv("PKIC_PUBLICATION_CACHE_ROOT", env.PKIC_PUBLICATION_CACHE_ROOT);
    await expect(prepareStaticPublicationFixture(checkout, env)).rejects.toThrow(
      "Static publication fixture build failed",
    );
    expect(fixtureDirectories(fixtures)).toEqual([]);
  });

  it("removes its directory and stops the build when the run exits", async () => {
    const { checkout, fixtures, env, pidFile } = synthetic("wait");
    const result = await stopsCleanly(runner(checkout, env, true), fixtures, pidFile);
    expect(result.code).toBe(0);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "removes its directory, stops the build and still ends the run on %s",
    async (signal) => {
      const { checkout, fixtures, env, pidFile } = synthetic("wait");
      const result = await stopsCleanly(runner(checkout, env, false), fixtures, pidFile, signal);
      expect(result.signal).toBe(signal);
    },
  );

  it("removes a killed run's directory on the next run and keeps live runs' directories", async () => {
    const { fixtures } = synthetic("wait");
    const ended = spawn(process.execPath, ["-e", ""]);
    await once(ended, "exit");
    const abandoned = `${STATIC_PUBLICATION_FIXTURE_PREFIX}${ended.pid}-abc123`;
    const live = `${STATIC_PUBLICATION_FIXTURE_PREFIX}${process.pid}-def456`;
    for (const name of [abandoned, live, "unrelated-directory"]) mkdirSync(join(fixtures, name), { recursive: true });
    await removeAbandonedStaticPublicationFixtures(fixtures);
    expect(readdirSync(fixtures).sort()).toEqual([live, "unrelated-directory"].sort());
  });
});

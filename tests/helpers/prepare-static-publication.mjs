import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rename, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { assembleStaticRelease } from "../../scripts/publication/assemble-static-release.mjs";
import { publicationCacheRoot } from "../../scripts/publication/build-context.mjs";

/** Every Worker test run's own generated site is named with this prefix and its owning process. */
export const STATIC_PUBLICATION_FIXTURE_PREFIX = "pkic-worker-fixture-";
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/** The repository's temporary root for build state: PKIC_BUILD_TMPDIR, else TMPDIR. */
export function staticPublicationFixtureRoot(env = process.env) {
  return resolve(env.PKIC_BUILD_TMPDIR || tmpdir());
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Remove fixtures whose run ended without its own cleanup, such as a killed process. */
export async function removeAbandonedStaticPublicationFixtures(root = staticPublicationFixtureRoot()) {
  let names;
  try {
    names = await readdir(root);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    const owner = new RegExp(`^${STATIC_PUBLICATION_FIXTURE_PREFIX}(\\d+)-`).exec(name);
    if (owner && !alive(Number(owner[1]))) rmSync(join(root, name), { recursive: true, force: true });
  }
}

function runBuild(root, env, stopped) {
  return new Promise((resolveBuild, rejectBuild) => {
    // Its own process group, so stopping the run stops pnpm, Astro and their workers together.
    const child = spawn("pnpm", ["run", "build:astro"], {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    stopped.child = child;
    child.on("error", rejectBuild);
    child.on("close", (status, signal) => {
      stopped.child = undefined;
      if (status === 0) resolveBuild();
      else
        rejectBuild(
          new Error(`Static publication fixture build failed (${signal ?? status}):\n${Buffer.concat(output)}`),
        );
    });
  });
}

/**
 * Worker integration tests consume the same Astro assets as a real deployment.
 *
 * The build writes its public assets, Astro output, staging and build cache
 * into a directory of this run's own, so concurrent runs in one checkout or
 * across checkouts sharing node_modules never replace each other's files.
 * The cache starts as a copy-on-write clone of the shared one and is never
 * written back. The directory is removed when the process exits or is
 * stopped, and on a failed build; a later run removes any left by a killed one.
 */
async function buildStaticPublicationFixture(root, env) {
  const temporaryRoot = staticPublicationFixtureRoot(env);
  await mkdir(temporaryRoot, { recursive: true });
  await removeAbandonedStaticPublicationFixtures(temporaryRoot);
  const directory = await mkdtemp(join(temporaryRoot, `${STATIC_PUBLICATION_FIXTURE_PREFIX}${process.pid}-`));
  const stopped = { child: undefined };
  const remove = () => {
    if (stopped.child?.pid) {
      try {
        process.kill(-stopped.child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    rmSync(directory, { recursive: true, force: true });
    process.off("exit", remove);
    for (const signal of STOP_SIGNALS) process.off(signal, stop);
  };
  function stop(signal) {
    remove();
    // Without another listener, keep the signal's default outcome for this process.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  }
  process.on("exit", remove);
  for (const signal of STOP_SIGNALS) process.on(signal, stop);
  try {
    const cache = resolve(directory, "cache");
    await cp(resolve(publicationCacheRoot(), "publication"), resolve(cache, "publication"), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    }).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await runBuild(
      root,
      {
        ...env,
        NODE_ENV: "production",
        CLOUDFLARE_ENV: "local",
        PKIC_PUBLICATION_SNAPSHOT: resolve(root, "tests/fixtures/site-publication.json"),
        PKIC_PUBLICATION_OUTPUT_ROOT: directory,
        PKIC_PUBLICATION_CACHE_ROOT: cache,
      },
      stopped,
    );
    const publicDirectory = resolve(directory, "public");
    await assembleStaticRelease(resolve(directory, "dist", "astro"), publicDirectory, "local");
    return { directory, publicDirectory, remove };
  } catch (error) {
    remove();
    throw error;
  }
}

/** Built sites kept for reuse, one directory per input hash. */
export const STATIC_PUBLICATION_FIXTURE_CACHE = "pkic-worker-fixture-cache";
const KEPT_FIXTURES = 3;
// Inputs that never reach the site build; the synthetic snapshot and this builder are added back.
const UNBUILT_PATHS = ["tests", "migrations", ".agents", ".github"];
const BUILD_INPUTS = ["tests/fixtures/site-publication.json", "tests/helpers/prepare-static-publication.mjs"];

const git = (root, args, env = process.env) =>
  execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * The tree hash of every file the site build can read, including uncommitted
 * and untracked ones: Git hashes the working tree into a scratch index (a copy
 * of the real one, so unchanged files are not read again). Null outside Git.
 */
export function staticPublicationInputHash(root) {
  let index;
  try {
    index = resolve(git(root, ["rev-parse", "--absolute-git-dir"]), "index");
  } catch {
    return null;
  }
  const scratch = mkdtempSync(join(tmpdir(), "pkic-fixture-index-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
    copyFileSync(index, env.GIT_INDEX_FILE);
    git(root, ["add", "--all", "--", "."], env);
    git(root, ["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", ...UNBUILT_PATHS], env);
    git(root, ["add", "--", ...BUILD_INPUTS], env);
    return git(root, ["write-tree"], env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Keep the most recently used built sites and remove the rest. */
async function pruneCachedFixtures(cacheRoot) {
  const entries = await readdir(cacheRoot, { withFileTypes: true });
  const kept = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^[0-9a-f]{40,64}$/.test(entry.name))
      .map(async (entry) => ({ name: entry.name, used: (await stat(join(cacheRoot, entry.name))).mtimeMs })),
  );
  kept.sort((a, b) => b.used - a.used);
  for (const { name } of kept.slice(KEPT_FIXTURES)) rmSync(join(cacheRoot, name), { recursive: true, force: true });
}

/**
 * Reuse the site built from the same inputs, or build it once and keep it.
 * The build still runs in this process's own directory; only its finished
 * public directory moves into the cache, by an atomic rename, so concurrent
 * runs never see a half-written site.
 */
async function cachedStaticPublicationFixture(root, env) {
  const hash = staticPublicationInputHash(root);
  if (!hash) return buildStaticPublicationFixture(root, env);
  const cacheRoot = resolve(staticPublicationFixtureRoot(env), STATIC_PUBLICATION_FIXTURE_CACHE);
  const cached = resolve(cacheRoot, hash);
  const publicDirectory = resolve(cached, "public");
  if (!existsSync(publicDirectory)) {
    const build = await buildStaticPublicationFixture(root, env);
    await mkdir(cached, { recursive: true });
    try {
      await rename(build.publicDirectory, publicDirectory);
    } catch (error) {
      // Another run finished the same inputs first; use its copy.
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
    }
    build.remove();
  }
  const now = new Date();
  await utimes(cached, now, now);
  await pruneCachedFixtures(cacheRoot);
  return { directory: cached, publicDirectory, remove() {} };
}

// Kept on globalThis so a re-imported copy of this module still finds the build.
const fixtureBuilds = (globalThis[Symbol.for("pkic.staticPublicationFixtureBuilds")] ??= new Map());

/**
 * One site per set of build inputs, reused across runs, and one build per
 * process: Vitest 5 evaluates a config function once per project and server
 * start, so concurrent evaluations share one promise.
 */
export function prepareStaticPublicationFixture(root, env = process.env) {
  if (env !== process.env) return buildStaticPublicationFixture(root, env);
  let build = fixtureBuilds.get(root);
  if (!build) {
    build = cachedStaticPublicationFixture(root, env);
    fixtureBuilds.set(root, build);
    build.catch(() => fixtureBuilds.delete(root));
  }
  return build;
}

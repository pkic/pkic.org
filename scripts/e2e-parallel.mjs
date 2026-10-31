/**
 * Run the browser suite as several independent shards on one machine.
 *
 * The specs share one seeded database and one email outbox, so they cannot run as parallel workers
 * inside a single server. Each shard instead gets its own copy of one prepared release and database
 * and its own port, and runs its slice of the specs, which is how CI splits the work too.
 *
 *   pnpm run test:e2e:parallel [--shards=3] [--base-port=8820] [--prepared=DIR] [playwright arguments...]
 *
 * The built release and seeded database are kept between runs, keyed by the product code they were built
 * from: a run on the same code (test files do not count) reuses them and starts in seconds, and a run after
 * a product change builds a new one. Only the newest few are kept. `--prepared=DIR` names the directory.
 */
const KEPT_RELEASES = 2;
const git = (...args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 }).stdout ?? "";

/** What the prepared release is built from: the commit plus uncommitted product changes, never test files. */
export function releaseKey(run = git) {
  const product = [".", ":(exclude)tests", ":(exclude)test-results"];
  const untracked = run("ls-files", "-o", "--exclude-standard", "--", ...product)
    .split("\n")
    .filter(Boolean)
    .map((file) => `${file}:${run("hash-object", "--", file).trim()}`);
  return createHash("sha1")
    .update([run("rev-parse", "HEAD"), run("diff", "HEAD", "--binary", "--", ...product), ...untracked].join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function pruneReleases(directory, keep) {
  const releases = readdirSync(directory)
    .map((name) => path.join(directory, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const stale of releases.slice(keep)) rmSync(stale, { recursive: true, force: true });
}

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { publicationCacheRoot } from "./publication/build-context.mjs";

/** One entry per shard: its `--shard` slice, its port, and its state directory name. */
export function shardPlan(count, basePort) {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    shard: `${index + 1}/${count}`,
    port: basePort + index,
    name: `pkic-e2e.shard-${index + 1}`,
  }));
}

/**
 * Specs publish the static site while the shards run side by side, so each shard builds into its
 * own output and cache: a shared one lets one shard's build delete files another is still copying.
 * Its cache starts as a clone of the checkout's, so the first build stays incremental.
 *
 * The output must lie inside the checkout. Astro bundles its prerender step beside an `outDir` within the
 * working directory, but for one outside it falls back to the checkout's own `.astro/.prerender`, which every
 * shard then shares and empties under the others; on another volume its final rename fails outright (EXDEV).
 */
export function shardPublicationEnvironment(state, output, cacheRoot = publicationCacheRoot()) {
  const cache = path.join(state, "publication-cache");
  const seed = path.join(cacheRoot, "publication");
  if (existsSync(seed))
    cpSync(seed, path.join(cache, "publication"), { recursive: true, mode: constants.COPYFILE_FICLONE });
  return {
    PKIC_PUBLICATION_OUTPUT_ROOT: output,
    PKIC_PUBLICATION_CACHE_ROOT: cache,
  };
}

/** Where a run's shards build their site publications: in the checkout, removed with the run. */
export function shardPublicationOutputRoot(checkout = process.cwd()) {
  const parent = path.join(checkout, ".cache", "e2e-publication");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "run."));
}

/** A shard is a Worker, its database and a browser; budget this much memory for each. */
const BYTES_PER_SHARD = 2 * 1024 ** 3;

/** One shard per core, unless the machine's memory holds fewer. */
export function defaultShards(cores = cpus().length, memory = totalmem()) {
  return Math.max(1, Math.min(cores, Math.floor(memory / BYTES_PER_SHARD)));
}

export function parseArguments(argv, defaults = defaultShards()) {
  const passthrough = [];
  let shards = defaults;
  let basePort = 8820;
  let prepared = null;
  for (const argument of argv) {
    if (argument.startsWith("--shards=")) shards = Number(argument.slice("--shards=".length));
    else if (argument.startsWith("--base-port=")) basePort = Number(argument.slice("--base-port=".length));
    else if (argument.startsWith("--prepared=")) prepared = path.resolve(argument.slice("--prepared=".length));
    else passthrough.push(argument);
  }
  if (!Number.isInteger(shards) || shards < 1) throw new Error("--shards must be a positive whole number");
  return { shards, basePort, prepared, passthrough };
}

function run() {
  const { shards, basePort, prepared: keptRelease, passthrough } = parseArguments(process.argv.slice(2));
  const root = mkdtempSync(path.join(process.env.E2E_STATE_ROOT ?? tmpdir(), "pkic-e2e-shards."));
  const releases = path.join(process.env.E2E_STATE_ROOT ?? tmpdir(), "pkic-e2e-releases");
  const prepared = keptRelease ?? path.join(releases, releaseKey());
  const outputs = shardPublicationOutputRoot();
  const cleanup = () => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputs, { recursive: true, force: true });
  };
  process.on("exit", cleanup);
  mkdirSync("test-results", { recursive: true });
  for (const stale of [
    "portal-management-verification",
    "portal-mobile-navigation",
    "portal-groups",
    "portal-vote-management",
  ])
    rmSync(`test-results/${stale}-auth.json`, { force: true });
  if (existsSync(path.join(prepared, ".prepared"))) {
    console.log(`[e2e-parallel] reusing the prepared release in ${prepared}`);
  } else {
    console.log(`[e2e-parallel] preparing one release for ${shards} shards`);
    rmSync(prepared, { recursive: true, force: true });
    mkdirSync(prepared, { recursive: true });
    const prepare = spawnSync("sh", ["scripts/e2e-prepare.sh", prepared], { stdio: "inherit" });
    if (prepare.status !== 0) process.exit(prepare.status ?? 1);
    if (!keptRelease) pruneReleases(releases, KEPT_RELEASES);
  }

  const results = shardPlan(shards, basePort).map(
    (plan) =>
      new Promise((resolve) => {
        const state = path.join(root, plan.name);
        cpSync(prepared, state, { recursive: true });
        const log = path.join(root, `${plan.name}.log`);
        const child = spawn(
          "pnpm",
          [
            "exec",
            "playwright",
            "test",
            `--shard=${plan.shard}`,
            `--output=test-results/shard-${plan.index}`,
            ...passthrough,
          ],
          {
            env: {
              ...process.env,
              E2E_STATE_ROOT: root,
              E2E_PREPARED_STATE_DIR: state,
              E2E_PORT: String(plan.port),
              E2E_SHARDED: "1",
              E2E_SENDGRID_URL_FILE: path.join(root, `${plan.name}.sendgrid-url`),
              E2E_STRIPE_URL_FILE: path.join(root, `${plan.name}.stripe-url`),
              ...shardPublicationEnvironment(state, path.join(outputs, plan.name)),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const chunks = [];
        for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => chunks.push(chunk));
        child.on("close", (code) => {
          writeFileSync(log, Buffer.concat(chunks));
          // The state root is removed on exit; keep each shard's output where a failure can be read afterwards.
          mkdirSync("test-results/e2e-parallel", { recursive: true });
          cpSync(log, path.join("test-results/e2e-parallel", `${plan.name}.log`));
          const text = readFileSync(log, "utf8");
          const failed = [...text.matchAll(/^\s+\d+\) (tests\/e2e\/[^\n]+)$/gm)].map((match) => match[1]);
          const summary = text.match(/^\s+(\d+) passed.*$/m)?.[0]?.trim() ?? "no summary";
          console.log(`[e2e-parallel] shard ${plan.shard} (port ${plan.port}): ${summary}`);
          for (const name of failed) console.log(`  failed: ${name}`);
          resolve(code ?? 1);
        });
      }),
  );
  Promise.all(results).then((codes) => process.exit(codes.some((code) => code !== 0) ? 1 : 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();

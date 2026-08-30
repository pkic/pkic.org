/**
 * External-command adapter: logo/photo file lookup on disk plus the real
 * `wrangler d1 execute`, remote `wrangler r2 object put`, and local R2 binding
 * access. Isolated here because it's the only part of the importer that shells
 * out or touches R2 — everything else (parsing, reconciliation, SQL rendering,
 * reporting) is a pure function over already-loaded data.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

/**
 * Requires an exact `<slug>.<ext>` match. Falling back to "the first file
 * in the directory" when no exact match exists previously risked silently
 * picking an unrelated file (e.g. a representative's headshot living in
 * the same directory) as the organization logo.
 */
export function findLogoFile(logoDir, slug) {
  const dir = path.join(logoDir, slug);
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir).filter((f) => /\.(svg|png|jpg|jpeg)$/i.test(f));
  const exact = candidates.find((f) => path.basename(f, path.extname(f)) === slug);
  return exact ? path.join(dir, exact) : null;
}

/**
 * Per-representative photo, sourced from the same `assets/images/members/<orgSlug>/`
 * directory as the org logo — the old Hugo `single.html` looked these up at
 * `/images/members/<orgSlug>/<repId-or-urlized-name>.*` (falling back to the
 * urlized representative name when no explicit `id` was set on the YAML
 * `representatives[]` entry). Distinct from `findLogoFile`, which only ever
 * matches the org's own `<orgSlug>.*` file.
 */
export function findRepPhotoFile(logoDir, orgSlug, rep, urlizeName) {
  const dir = path.join(logoDir, orgSlug);
  if (!fs.existsSync(dir)) return null;
  const repSlug = String(rep.id ?? urlizeName(rep.name));
  if (!repSlug) return null;
  const candidates = fs.readdirSync(dir).filter((f) => /\.(svg|png|jpg|jpeg)$/i.test(f));
  const exact = candidates.find((f) => path.basename(f, path.extname(f)) === repSlug);
  return exact ? path.join(dir, exact) : null;
}

export function runWranglerD1(root, envConfig, cli, sql) {
  const tmpPath = path.join(os.tmpdir(), `pkic-migrate-members-${Date.now()}.sql`);
  fs.writeFileSync(tmpPath, sql, "utf8");
  const args = [
    "wrangler",
    "d1",
    "execute",
    cli.database,
    "--env",
    envConfig.wranglerEnv,
    envConfig.wranglerFlag,
    ...(cli.persistTo ? [`--persist-to=${cli.persistTo}`] : []),
    "--file",
    tmpPath,
  ];
  try {
    execFileSync("pnpm", ["exec", ...args], { cwd: root, stdio: "inherit" });
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

function runInheritedCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal ? `${command} was terminated by signal ${signal}` : `${command} exited with status ${String(code)}`,
        ),
      );
    });
  });
}

async function getLocalPlatformProxy(options) {
  const { getPlatformProxy } = await import("wrangler");
  return getPlatformProxy(options);
}

/**
 * Run independent operations with a fixed upper bound. Once one operation
 * fails, no new work is scheduled; already-running operations are allowed to
 * finish before the original failure is reported.
 */
export async function runWithConcurrency(items, concurrency, operation) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Upload concurrency must be a positive integer");
  }
  if (items.length === 0) return;

  let nextIndex = 0;
  let failure = null;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!failure) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        await operation(items[index], index);
      } catch (error) {
        failure ??= error;
      }
    }
  });

  await Promise.all(workers);
  if (failure) throw failure;
}

async function uploadLogosToLocalR2(root, cli, logoUploads, dependencies) {
  const temporaryConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-member-r2-"));
  const configPath = path.join(temporaryConfigDir, "wrangler.json");
  const persistenceRoot = path.resolve(root, cli.persistTo ?? ".wrangler/state");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      name: "pkic-member-image-migration",
      compatibility_date: "2026-08-30",
      r2_buckets: [{ binding: "ASSETS_BUCKET", bucket_name: cli.logoBucket }],
    }),
  );

  let platformProxy;
  try {
    // Wrangler's `--persist-to` is the parent of its Miniflare v3 state.
    // Use one local workerd instance for the complete batch so concurrent puts
    // don't start competing SQLite recovery processes.
    platformProxy = await dependencies.getPlatformProxy({
      configPath,
      persist: { path: path.join(persistenceRoot, "v3") },
      remoteBindings: false,
    });
    const bucket = platformProxy.env.ASSETS_BUCKET;
    if (!bucket || typeof bucket.put !== "function") {
      throw new Error("The local ASSETS_BUCKET R2 binding is unavailable");
    }
    await runWithConcurrency(logoUploads, cli.logoConcurrency, async ({ filePath, r2Key }) => {
      await bucket.put(r2Key, await dependencies.readFile(filePath));
    });
  } finally {
    try {
      await platformProxy?.dispose();
    } finally {
      fs.rmSync(temporaryConfigDir, { recursive: true, force: true });
    }
  }
}

export async function uploadLogosToR2(root, envConfig, cli, logoUploads, injectedDependencies = {}) {
  const dependencies = {
    getPlatformProxy: getLocalPlatformProxy,
    readFile: fs.promises.readFile,
    runCommand: runInheritedCommand,
    ...injectedDependencies,
  };

  if (envConfig.wranglerFlag === "--local") {
    await uploadLogosToLocalR2(root, cli, logoUploads, dependencies);
    return;
  }

  await runWithConcurrency(logoUploads, cli.logoConcurrency, async ({ filePath, r2Key }) => {
    const args = ["r2", "object", "put", `${cli.logoBucket}/${r2Key}`, "--file", filePath, envConfig.wranglerFlag];
    // The importer is run through `pnpm migrate:members`, so Wrangler's binary
    // is already on PATH. Avoid an extra `pnpm exec` process per remote object.
    await dependencies.runCommand("wrangler", args, { cwd: root });
  });
}

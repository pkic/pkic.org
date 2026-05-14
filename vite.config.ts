import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clearTimeout, setTimeout } from "node:timers";
import { relative, resolve, sep } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(projectRoot, "public");
const hugoBuildState = globalThis as typeof globalThis & {
  __pkicHugoBuildPromise?: Promise<void>;
  __pkicHugoDevBuildPromise?: Promise<void>;
};

const hugoSourcePaths = [
  "archetypes",
  "assets",
  "config",
  "content",
  "data",
  "i18n",
  "layouts",
  "static",
  "config.yaml",
  "go.mod",
  "go.sum",
];

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code ?? 1}`}`));
    });
  });
}

async function buildFrontendBundles(isDev: boolean): Promise<void> {
  const args = isDev ? ["--dev"] : [];
  await run("node", ["scripts/build-frontend.mjs", ...args]);
}

async function buildHugoSite(isDev: boolean, rebuildFrontend = true): Promise<void> {
  // Frontend bundles must be built before Hugo so the asset manifest is ready.
  if (rebuildFrontend) {
    await buildFrontendBundles(isDev);
  }
  const cloudflareEnv = process.env.CLOUDFLARE_ENV ?? "local";

  if (!isDev && cloudflareEnv !== "local") {
    // Clone any missing submodules at the SHAs recorded in the parent
    // commit. Critically, no --remote here: tag-pinned snapshots like
    // content/wg/pkimm/1.0.0 (no `branch=` in .gitmodules) must stay at
    // their pinned SHA — passing --remote here would silently bump them
    // to the remote HEAD branch (typically main) and override the pin.
    await run("git", ["submodule", "update", "--init", "--recursive"]);
    // Then refresh only the submodules that explicitly track a moving
    // branch (have a `branch =` field in .gitmodules) to the latest tip.
    // Mirrors the logic in scripts/build.sh.
    //
    // `git config --get-regexp` exits 1 if there are no matches (or if
    // .gitmodules is missing entirely), which would make execFileSync
    // throw. Catch that so a repo with no branch-tracking submodules
    // doesn't break the build.
    let branchEntries: string[] = [];
    try {
      branchEntries = execFileSync(
        "git",
        ["config", "-f", ".gitmodules", "--name-only", "--get-regexp", "^submodule\\..*\\.branch$"],
        { cwd: projectRoot, encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
    } catch {
      // No branch-tracking submodules — nothing to refresh.
    }
    for (const entry of branchEntries) {
      const name = entry.replace(/^submodule\./, "").replace(/\.branch$/, "");
      const path = execFileSync(
        "git",
        ["config", "-f", ".gitmodules", "--get", `submodule.${name}.path`],
        { cwd: projectRoot, encoding: "utf8" },
      ).trim();
      if (path) {
        await run("git", ["submodule", "update", "--remote", "--", path]);
      }
    }
  }

  const hugoArgs = ["--destination", "public"];

  // Only clean the destination dir for production builds — in dev the wipe
  // races with Vite's static-file serving causing broken styles until Hugo
  // finishes writing the new fingerprinted CSS.
  if (!isDev) {
    hugoArgs.push("--cleanDestinationDir");
  }

  if (isDev) {
    hugoArgs.push("--environment", "development");
  } else {
    hugoArgs.push("--minify");
  }

  await run("hugo", hugoArgs);
  await run("pnpm", ["exec", "pagefind", "--site", "./public/"]);
}

function buildHugoSiteOnce(isDev: boolean): Promise<void> {
  const promiseKey = isDev ? "__pkicHugoDevBuildPromise" : "__pkicHugoBuildPromise";

  hugoBuildState[promiseKey] ??= buildHugoSite(isDev).catch((error: unknown) => {
    delete hugoBuildState[promiseKey];
    throw error;
  });
  return hugoBuildState[promiseKey];
}

function isHugoSource(file: string): boolean {
  const relativePath = relative(projectRoot, file);

  if (relativePath.startsWith("..") || relativePath.startsWith(`${sep}`)) {
    return false;
  }

  // Exclude Vite-built frontend artifacts. These are written by buildFrontendBundles()
  // which is called *inside* buildHugoSite(). Letting them trigger another rebuild
  // would create an infinite loop: build → write files → watch fires → build again.
  if (
    relativePath.startsWith(`static${sep}js${sep}built`) ||
    relativePath === `data${sep}asset-manifest.json`
  ) {
    return false;
  }

  return hugoSourcePaths.some((sourcePath) => relativePath === sourcePath || relativePath.startsWith(`${sourcePath}${sep}`));
}

function hugoPlugin(): Plugin {
  let currentBuild: Promise<void> | null = null;
  let queuedBuild = false;
  let pendingFrontendRebuild = false;

  async function queueBuild(server?: ViteDevServer, rebuildFrontend = false): Promise<void> {
    if (rebuildFrontend) pendingFrontendRebuild = true;
    if (currentBuild) {
      queuedBuild = true;
      return currentBuild;
    }

    do {
      queuedBuild = false;
      const doFrontend = pendingFrontendRebuild;
      pendingFrontendRebuild = false;
      currentBuild = buildHugoSite(Boolean(server), doFrontend);
      try {
        await currentBuild;
      } finally {
        currentBuild = null;
      }
    } while (queuedBuild);

    server?.ws.send({ type: "full-reload" });
  }

  return {
    name: "pkic-hugo",
    async config(_, { command }) {
      if (command === "build") {
        await buildHugoSiteOnce(false);
      }

      if (command === "serve") {
        await buildHugoSiteOnce(true);
      }
    },
    async configureServer(server) {
      await buildHugoSiteOnce(true);

      server.watcher.add(hugoSourcePaths.map((sourcePath) => resolve(projectRoot, sourcePath)));

      let reloadTimer: NodeJS.Timeout | undefined;
      const scheduleRebuild = (file: string): void => {
        if (!isHugoSource(file)) {
          return;
        }

        if (reloadTimer) {
          clearTimeout(reloadTimer);
        }

        const relPath = relative(projectRoot, file);
        const isTsFile = relPath.startsWith(`assets${sep}ts${sep}`);

        reloadTimer = setTimeout(() => {
          void queueBuild(server, isTsFile).catch((error: unknown) => {
            server.config.logger.error(error instanceof Error ? error.message : String(error));
          });
        }, 100);
      };

      server.watcher.on("add", scheduleRebuild);
      server.watcher.on("change", scheduleRebuild);
      server.watcher.on("unlink", scheduleRebuild);
    },
  };
}

export default defineConfig(() => {
  // Auto-detect Cloudflare environment for CI builds.
  // Must run here (not at top level) so it executes before cloudflare() reads it,
  // since ESM hoists imports above top-level statements.
  if (!process.env.CLOUDFLARE_ENV) {
    const branch = process.env.WORKERS_CI_BRANCH;
    process.env.CLOUDFLARE_ENV = branch && branch.toLowerCase() === "main" ? "production" : branch ? "preview" : "local";
  }

  // In CI preview builds, patch APP_BASE_URL in wrangler.jsonc to match the
  // branch-specific preview URL so the subsequent `wrangler versions upload`
  // deploy step also picks it up. Uses text replacement to preserve JSONC formatting.
  const ciBranch = process.env.WORKERS_CI_BRANCH;
  if (ciBranch && ciBranch.toLowerCase() !== "main") {
    const sanitized = ciBranch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const previewUrl = `https://${sanitized}-pkic-org.pkic.workers.dev`;
    const configFile = resolve(projectRoot, "wrangler.jsonc");
    const content = readFileSync(configFile, "utf8");
    const patched = content.replace(
      /("APP_BASE_URL"\s*:\s*)"https:\/\/[^"]*\.pkic\.workers\.dev\/?"/,
      `$1"${previewUrl}"`,
    );
    if (patched !== content) {
      writeFileSync(configFile, patched);
      console.log(`Preview APP_BASE_URL set to ${previewUrl}`);
    }
  }

  return {
    clearScreen: false,
    publicDir,
    server: {
      host: "0.0.0.0",
      port: 8788,
      strictPort: true,
      watch: {
        ignored: ["**/dist/**", "**/public/**"],
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 8788,
      strictPort: true,
    },
    plugins: [hugoPlugin(), cloudflare()],
  };
});

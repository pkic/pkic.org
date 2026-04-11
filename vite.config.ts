import { spawn } from "node:child_process";
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

async function buildHugoSite(isDev: boolean): Promise<void> {
  const cloudflareEnv = process.env.CLOUDFLARE_ENV ?? "local";

  if (!isDev && cloudflareEnv !== "local") {
    await run("git", ["submodule", "update", "--init", "--remote"]);
  }

  const hugoArgs = ["--destination", "public", "--cleanDestinationDir"];

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

  return hugoSourcePaths.some((sourcePath) => relativePath === sourcePath || relativePath.startsWith(`${sourcePath}${sep}`));
}

function hugoPlugin(): Plugin {
  let currentBuild: Promise<void> | null = null;
  let queuedBuild = false;

  async function queueBuild(server?: ViteDevServer): Promise<void> {
    if (currentBuild) {
      queuedBuild = true;
      return currentBuild;
    }

    do {
      queuedBuild = false;
      currentBuild = buildHugoSite(Boolean(server));
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

        reloadTimer = setTimeout(() => {
          void queueBuild(server).catch((error: unknown) => {
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

export default defineConfig({
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
});

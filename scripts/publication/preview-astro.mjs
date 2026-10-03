import { cp, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { unstable_readConfig as readConfig } from "wrangler";
import { assembleStaticRelease } from "./assemble-static-release.mjs";

// Browser tests must enforce the same native headers and redirects as deployment.
const root = await mkdtemp(resolve(process.env.E2E_STATE_ROOT ?? tmpdir(), "pkic-static-preview-"));
try {
  const assets = resolve(root, "assets");
  const main = resolve(root, "worker.mjs");
  await cp(resolve("dist/astro"), assets, { recursive: true, mode: constants.COPYFILE_FICLONE });
  await copyFile(resolve("static/_headers"), resolve(assets, "_headers"));
  await assembleStaticRelease(resolve("dist/astro"), assets, "local");
  await writeFile(
    main,
    'export default { fetch() { return new Response("API unavailable in static preview", { status: 503 }); } };',
  );
  const config = readConfig({ config: resolve("wrangler.jsonc"), env: "local" });
  const configPath = resolve(root, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "pkic-static-preview",
      main,
      compatibility_date: config.compatibility_date,
      assets: { ...config.assets, directory: assets },
    }),
  );
  const server = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--config",
      configPath,
      "--ip",
      "127.0.0.1",
      "--port",
      process.env.PKIC_STATIC_PREVIEW_PORT ?? "8791",
      "--persist-to",
      resolve(root, "state"),
    ],
    { stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.kill(signal));

  const [code] = await once(server, "exit");
  process.exitCode = code ?? 0;
} finally {
  await rm(root, { recursive: true, force: true });
}

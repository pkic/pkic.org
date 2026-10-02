import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assembleStaticRelease } from "./assemble-static-release.mjs";

const result = spawnSync("pnpm", ["run", "build:astro"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", CLOUDFLARE_ENV: "local" },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await assembleStaticRelease(resolve("dist/astro"), resolve(process.argv[2] ?? "public"), "local");

import { spawnSync } from "node:child_process";
import { publicationEnvironment } from "./publication/build-context.mjs";

process.env.CLOUDFLARE_ENV = publicationEnvironment();
const environment = process.env.CLOUDFLARE_ENV;
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ["--experimental-strip-types", "scripts/prepare-public.mjs"]);
run("pnpm", ["exec", "vite", "build"]);
run("pnpm", ["exec", "astro", "build", "--config", "astro.config.mjs"]);
run(process.execPath, [
  "--experimental-strip-types",
  "scripts/generate-openapi.mjs",
  environment,
  "--config",
  "dist/pkic_org_base/wrangler.json",
  "--output",
  "dist/client",
]);
run(process.execPath, ["--experimental-strip-types", "scripts/publication/assemble-static-release.mjs"]);

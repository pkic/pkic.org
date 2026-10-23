import { logPublicationBuildCache } from "./publication/log-build-cache.mjs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { publicationEnvironment } from "./publication/build-context.mjs";

process.env.CLOUDFLARE_ENV = publicationEnvironment();
const environment = process.env.CLOUDFLARE_ENV;
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await logPublicationBuildCache("after dependency installation");
process.env.PKIC_MODEL_REGISTRY_PATH = resolve("node_modules/.cache/model-versions/build-registry.yaml");
run(process.execPath, [
  "--experimental-strip-types",
  "scripts/models/refresh-draft-pins.ts",
  "--allow-unavailable",
  "--output",
  process.env.PKIC_MODEL_REGISTRY_PATH,
]);
run(process.execPath, ["--experimental-strip-types", "scripts/prepare-public.mjs"]);
run("pnpm", ["exec", "vite", "build"]);
run("pnpm", [
  "exec",
  "astro",
  "build",
  "--config",
  "astro.config.mjs",
  ...(process.env.PKIC_PUBLICATION_FORCE_REBUILD === "1" ? ["--force"] : []),
]);
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

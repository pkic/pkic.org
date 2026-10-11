import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Build the current application against rehearsal data, then retain its isolated runtime bindings. */
export function buildRehearsalSite(root, state, env, runBuild = execFileSync) {
  runBuild(process.execPath, ["--experimental-strip-types", "scripts/build-site.mjs"], {
    cwd: root,
    // The CLI appends v3 to --persist-to; getPlatformProxy uses its path directly.
    env: { ...env, CLOUDFLARE_ENV: "local", PKIC_PUBLICATION_LOCAL_STATE: path.join(state, "v3") },
    stdio: "inherit",
  });
  const deployPath = path.join(root, ".wrangler/deploy/config.json");
  const deployment = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  const builtConfigPath = path.resolve(path.dirname(deployPath), deployment.configPath);
  const builtConfig = JSON.parse(fs.readFileSync(builtConfigPath, "utf8"));
  const configPath = path.join(state, "wrangler.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const main = path.resolve(path.dirname(builtConfigPath), builtConfig.main);
  if (!fs.statSync(main).isFile()) throw new Error("The rehearsal build did not produce a Worker bundle");
  fs.rmSync(path.join(state, "site"), { recursive: true, force: true });
  fs.cpSync(path.join(root, "dist/client"), path.join(state, "site"), { recursive: true });
  const worker = path.join(state, "worker");
  fs.rmSync(worker, { recursive: true, force: true });
  fs.cpSync(path.dirname(builtConfigPath), worker, { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      { ...config, main: path.resolve(worker, builtConfig.main), no_bundle: true, rules: builtConfig.rules },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

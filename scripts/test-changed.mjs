import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Run the tests related to changed files in every Vitest suite. By default the
 * change set is the uncommitted work; `--since <ref>` compares with a commit
 * or branch instead (for example `--since pr-head/main` before a push).
 *
 * Selection follows the static import graph, so it is advisory here: Worker
 * routes and migrations are not always visible through imports, and the full
 * `pnpm run check` still runs before a push and in CI.
 */
export const SUITE_CONFIGS = [
  "vitest.config.unit.ts",
  "vitest.config.frontend.ts",
  "vitest.config.tools.ts",
  "vitest.config.ts",
];

export function changedTestArgs(config, argv) {
  const args = [...argv];
  const index = args.indexOf("--since");
  const since = index === -1 ? undefined : args.splice(index, 2)[1];
  if (index !== -1 && (!since || since.startsWith("-"))) throw new Error("Usage: pnpm test:changed [--since <ref>]");
  const changed = since ? `--changed=${since}` : "--changed";
  return [
    "exec",
    "vitest",
    "run",
    "--config",
    config,
    "--configLoader",
    "runner",
    changed,
    "--passWithNoTests",
    ...args,
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let failed = false;
  for (const config of SUITE_CONFIGS) {
    console.log(`\n▶ ${config}`);
    const result = spawnSync("pnpm", changedTestArgs(config, process.argv.slice(2)), { stdio: "inherit" });
    if (result.error) throw result.error;
    failed ||= result.status !== 0;
  }
  process.exitCode = failed ? 1 : 0;
}

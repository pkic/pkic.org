import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PREVIEW_DATABASE_NAME } from "./lib/wrangler-target.mjs";

/**
 * Wrangler arguments that export the target's remote database. `d1 export` has
 * no --preview option, so the preview backup names the shared preview database.
 */
export function backupExportArgs(target, output) {
  const database = { preview: PREVIEW_DATABASE_NAME, production: "DB" }[target];
  if (!database) throw new Error("Usage: pnpm backup <preview|production>");
  return ["d1", "export", database, "--env", "production", "--remote", "--output", output];
}

/** Export the target's database read-only into `backups/d1/` and return the dump's path. */
export function exportD1Backup(target, root = process.cwd()) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const output = join(root, "backups", "d1", `${target}-${stamp}.sql`);
  const args = backupExportArgs(target, output);
  mkdirSync(join(root, "backups", "d1"), { recursive: true });
  execFileSync("pnpm", ["exec", "wrangler", ...args], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, ["scripts/reorder-d1-dump.mjs", output], { cwd: root, stdio: "inherit" });
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(`Backup written to ${exportD1Backup(process.argv[2])}`);
}

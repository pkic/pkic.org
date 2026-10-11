import { execFileSync } from "node:child_process";
import { buildWranglerD1ExecuteArgs } from "./seed-cli.mjs";

/**
 * Read only metadata or existence flags; never fetch production row contents.
 * @param {(command: string, args: string[], options: import('node:child_process').ExecFileSyncOptionsWithStringEncoding) => string} [execute]
 */
export function readSeedDatabaseRows(options, sql, execute = execFileSync) {
  const output = execute("pnpm", ["exec", ...buildWranglerD1ExecuteArgs(options), "--json", "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = JSON.parse(output);
  if (result.length !== 1 || result[0].success !== true || !Array.isArray(result[0].results)) {
    throw new Error("Seed preflight did not return one successful D1 result");
  }
  return result[0].results;
}

export function buildSeedPopulationCheckSql(tableNames) {
  if (tableNames.length === 0) return "SELECT 0 AS populated";
  const checks = tableNames.map((name) => `EXISTS (SELECT 1 FROM "${name.replaceAll('"', '""')}" LIMIT 1)`);
  return `SELECT (${checks.join(" OR ")}) AS populated`;
}

/**
 * Broad production seeding is bootstrap-only, before migrations or seed writes.
 * @param {(command: string, args: string[], options: import('node:child_process').ExecFileSyncOptionsWithStringEncoding) => string} [execute]
 */
export function requireEmptyProductionSeedDatabase(options, execute = execFileSync) {
  const tables = readSeedDatabaseRows(
    options,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
    execute,
  );
  const rows = readSeedDatabaseRows(options, buildSeedPopulationCheckSql(tables.map(({ name }) => name)), execute);
  if (rows.length !== 1 || rows[0].populated !== 0) {
    throw new Error(
      "Production seeding requires an empty database. No migrations or seed writes were run. Use the dedicated administrator --recover command for recovery.",
    );
  }
}

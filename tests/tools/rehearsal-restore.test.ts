import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { restoreRehearsalDump } from "../../scripts/rehearsal/restore.mjs";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "rehearsal-restore-"));
  directories.push(directory);
  return { directory, dump: path.join(directory, "dump.sql"), state: path.join(directory, "state") };
}

it("restores oversized exported rows through init and exposes intact data and triggers through local D1", () => {
  const { directory, dump, state } = fixture();
  // Exceed D1's SQL limit with a single row, including multibyte text and SQL
  // delimiters. Escaped quotes and trigger bodies must survive reordering.
  const payload = "snapshot; '日本語'\n".repeat(12_000);
  const sql = `PRAGMA defer_foreign_keys = ON;
CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id), payload TEXT);
CREATE TRIGGER prevent_child_delete BEFORE DELETE ON children BEGIN
  SELECT RAISE(ABORT, 'fixture guard');
END;
INSERT INTO children VALUES (1, 2, '${payload.replaceAll("'", "''")}');
CREATE TABLE parents (id INTEGER PRIMARY KEY);
INSERT INTO parents VALUES (2);
`;
  writeFileSync(dump, sql);
  const root = process.cwd();
  const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  run([path.join(root, "scripts/dev-rehearsal.mjs"), "init", "--state", state, "--dump", dump]);
  const execute = (args: string[]) =>
    run([
      wrangler,
      "d1",
      "execute",
      "DB",
      "--config",
      path.join(state, "wrangler.json"),
      "--local",
      "--persist-to",
      state,
      "--json",
      ...args,
    ]);
  // Reproduce the old path's failure against a separate empty table.
  const oversized = path.join(directory, "oversized.sql");
  writeFileSync(
    oversized,
    `CREATE TABLE old_import (payload TEXT); INSERT INTO old_import VALUES ('${"x".repeat(110_000)}');`,
  );
  expect(() => execute(["--file", oversized])).toThrow(/statement too long/);
  const result = JSON.parse(execute(["--command", "SELECT payload FROM children"]))[0].results;
  expect(result).toEqual([{ payload }]);
  expect(JSON.parse(execute(["--command", "PRAGMA foreign_key_check"]))[0].results).toEqual([]);
  expect(() => execute(["--command", "DELETE FROM children"])).toThrow(/fixture guard/);
  expect(JSON.parse(readFileSync(path.join(state, "rehearsal.json"), "utf8")).ready).toBe(true);
  expect(readFileSync(dump, "utf8")).toBe(sql);
});

it("rolls back an invalid snapshot and refuses to overwrite an existing schema", () => {
  const { dump, state } = fixture();
  const directory = path.join(state, "v3", "d1", "miniflare-D1DatabaseObject");
  mkdirSync(directory, { recursive: true });
  const databasePath = path.join(directory, "fixture.sqlite");
  new DatabaseSync(databasePath).close();
  writeFileSync(
    dump,
    "CREATE TABLE parents (id INTEGER PRIMARY KEY); CREATE TABLE children (parent_id REFERENCES parents(id)); INSERT INTO children VALUES (1);",
  );
  expect(() => restoreRehearsalDump(state, dump)).toThrow("foreign key violations");
  const database = new DatabaseSync(databasePath);
  try {
    expect(database.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
    database.exec("CREATE TABLE existing (value TEXT); INSERT INTO existing VALUES ('retained');");
    expect(() => restoreRehearsalDump(state, dump)).toThrow("existing rehearsal schema");
    expect(database.prepare("SELECT value FROM existing").get()).toEqual({ value: "retained" });
  } finally {
    database.close();
  }
});

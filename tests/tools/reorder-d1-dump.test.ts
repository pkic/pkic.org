import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const reorderScript = new URL("../../scripts/reorder-d1-dump.mjs", import.meta.url).href;
const wrangler = path.join(
  path.dirname(createRequire(import.meta.url).resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "d1-dump-"));
  directories.push(directory);
  return directory;
}

function reorder(dump: string) {
  // Set umask only in the child, keeping concurrent tests unaffected.
  return execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    "process.umask(0o077); await import(process.argv[1]);",
    reorderScript,
    dump,
  ]);
}

it.skipIf(process.platform === "win32").each([0o600, 0o640])("preserves mode %i under a restrictive umask", (mode) => {
  const dump = path.join(temporaryDirectory(), "dump.sql");
  writeFileSync(dump, "CREATE TABLE fixture (id TEXT);", { mode });
  chmodSync(dump, mode);
  reorder(dump);
  expect(statSync(dump).mode & 0o777).toBe(mode);
});

it("restores a migrated database without replaying triggers, then enforces them on subsequent writes", () => {
  const directory = temporaryDirectory();
  const source = path.join(directory, "source");
  const restored = path.join(directory, "restored");
  mkdirSync(source);
  mkdirSync(restored);
  const dump = path.join(directory, "dump.sql");
  const config = JSON.stringify({
    name: "dump-restore-test",
    compatibility_date: "2026-10-10",
    d1_databases: [
      {
        binding: "DB",
        database_name: "dump-test",
        database_id: "local-dump-test",
        migrations_dir: path.join(root, "migrations"),
      },
    ],
  });
  // Wrangler resolves default persistence relative to its config, not --cwd.
  for (const state of [source, restored]) writeFileSync(path.join(state, "wrangler.json"), config);
  // Run the installed CLI through Node so Windows never launches pnpm.cmd.
  const run = (state: string, args: string[]) =>
    execFileSync(
      process.execPath,
      [wrangler, "d1", ...args, "--config", path.join(state, "wrangler.json"), "--local", "--cwd", state],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  const execute = (state: string, sql: string) => run(state, ["execute", "DB", "--command", sql, "--json"]);
  const query = (state: string, sql: string) => JSON.parse(execute(state, sql))[0].results;
  run(source, ["migrations", "apply", "DB"]);
  const at = "2026-10-10T00:00:00.000Z";
  execute(
    source,
    `
INSERT INTO users (id, email, normalized_email, created_at, updated_at)
VALUES ('user-2', 'second@example.test', 'second@example.test', '${at}', '${at}');
INSERT INTO users (id, email, normalized_email, pending_email, created_at, updated_at)
VALUES ('user-1', 'first@example.test', 'first@example.test', 'second@example.test', '${at}', '${at}');
INSERT INTO groups (id, type_key, name, slug, created_at, updated_at)
VALUES ('group-1', 'working_group', 'Restore group', 'restore-group', '${at}', '${at}');
INSERT INTO events (id, slug, name, timezone, owner_group_id, created_at, updated_at)
VALUES ('event-1', 'restore-event', 'Restore event', 'UTC', 'group-1', '${at}', '${at}');
INSERT INTO event_participants (id, event_id, user_id, role, source_type, created_at, updated_at)
VALUES ('participant-1', 'event-1', 'user-1', 'attendee', 'manual', '${at}', '${at}');
`,
  );
  const revisionSql =
    "SELECT revision FROM event_participant_source_revisions WHERE event_id = 'event-1' AND user_id = 'user-1'";
  expect(query(source, revisionSql)).toEqual([{ revision: 1 }]);
  run(source, ["export", "DB", "--output", dump]);
  const exported = readFileSync(dump, "utf8");
  // The owning group is created later than events in the real migration history.
  expect(exported.indexOf('INSERT INTO "events"')).toBeLessThan(exported.indexOf("CREATE TABLE groups"));
  chmodSync(dump, 0o600);
  reorder(dump);
  const reordered = readFileSync(dump, "utf8");
  reorder(dump);
  expect(readFileSync(dump, "utf8")).toBe(reordered);
  expect(statSync(dump).isFile()).toBe(true);
  if (process.platform !== "win32") expect(statSync(dump).mode & 0o777).toBe(0o600);
  run(restored, ["execute", "DB", "--file", dump, "--yes"]);
  expect(query(restored, revisionSql)).toEqual(query(source, revisionSql));
  expect(query(restored, "SELECT COUNT(*) AS count FROM users")).toEqual([{ count: 2 }]);
  expect(query(restored, "PRAGMA foreign_key_check")).toEqual([]);
  expect(query(restored, "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")).toEqual(
    query(source, "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name"),
  );
  expect(() =>
    run(restored, [
      "execute",
      "DB",
      "--command",
      `INSERT INTO user_emails (id, user_id, email, normalized_email, created_at)
VALUES ('email-1', 'user-1', 'second@example.test', 'second@example.test', '${at}')`,
    ]),
  ).toThrow(/EMAIL_TAKEN/);
  execute(restored, "DELETE FROM event_participants WHERE id = 'participant-1'");
  expect(query(restored, revisionSql)).toEqual([{ revision: 2 }]);
});

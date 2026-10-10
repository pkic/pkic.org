import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

it("restores a snapshot without firing triggers, then enforces them on subsequent writes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "d1-dump-"));
  directories.push(directory);
  const dump = path.join(directory, "dump.sql");
  const config = path.join(directory, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name: "dump-restore-test",
      compatibility_date: "2026-10-10",
      d1_databases: [{ binding: "DB", database_name: "dump-test", database_id: "local-dump-test" }],
    }),
  );
  // This is a valid snapshot: a user can have a pending change to their own
  // secondary email. Replaying the secondary-email insert guard rejects it.
  // An early child table also exercises forward foreign-key references.
  writeFileSync(
    dump,
    `PRAGMA defer_foreign_keys = ON;
CREATE TABLE user_emails (user_id TEXT REFERENCES users(id), normalized_email TEXT UNIQUE);
INSERT INTO user_emails VALUES ('user-1', 'secondary@example.test');
CREATE TABLE users (id TEXT PRIMARY KEY, pending_email TEXT, revision INTEGER);
INSERT INTO users VALUES ('user-1', 'secondary@example.test', 7);
CREATE TRIGGER reserve_email BEFORE INSERT ON user_emails
WHEN EXISTS (SELECT 1 FROM users WHERE pending_email = NEW.normalized_email)
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_TAKEN');
END;
CREATE TRIGGER advance_revision AFTER INSERT ON user_emails
BEGIN
  UPDATE users SET revision = revision + 1 WHERE id = NEW.user_id;
END;
`,
    { mode: 0o600 },
  );
  const reorder = () => execFileSync(process.execPath, ["scripts/reorder-d1-dump.mjs", dump]);
  reorder();
  const reordered = readFileSync(dump, "utf8");
  reorder();
  expect(readFileSync(dump, "utf8")).toBe(reordered);
  expect(statSync(dump).mode & 0o777).toBe(0o600);

  const execute = (args: string[]) =>
    execFileSync(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--config", config, "--local", "--persist-to", directory, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  execute(["--file", dump, "--yes"]);
  const query = (sql: string) => JSON.parse(execute(["--command", sql, "--json"]))[0].results;
  expect(query("SELECT revision FROM users")).toEqual([{ revision: 7 }]);
  expect(query("SELECT COUNT(*) AS count FROM user_emails")).toEqual([{ count: 1 }]);
  expect(query("PRAGMA foreign_key_check")).toEqual([]);
  expect(() => execute(["--command", "INSERT INTO user_emails VALUES ('user-1', 'secondary@example.test')"])).toThrow(
    /EMAIL_TAKEN/,
  );
  execute(["--command", "INSERT INTO user_emails VALUES ('user-1', 'other@example.test')"]);
  expect(query("SELECT revision FROM users")).toEqual([{ revision: 8 }]);
});

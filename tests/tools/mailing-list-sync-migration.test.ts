import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("creates independent list settings directly in the consolidated migration", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync("migrations")
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()) {
      db.exec(readFileSync(`migrations/${name}`, "utf8"));
    }
    const list = db.prepare("SELECT id, group_id FROM mailing_lists LIMIT 1").get()!;
    const timestamp = "2026-09-18T12:00:00.000Z";
    db.prepare(
      "INSERT INTO mailing_lists (id, email, label, purpose, group_id, created_at, updated_at) VALUES (?, ?, ?, 'group', ?, ?, ?)",
    ).run("sibling-list", "users@organization.test", "Organization users", list.group_id, timestamp, timestamp);
    db.prepare(
      "INSERT INTO mailing_list_sync_settings (mailing_list_id, enabled, revision, updated_at) VALUES (?, 0, 3, ?)",
    ).run(list.id, timestamp);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'group_mailing_sync_settings'").get(),
    ).toBeUndefined();
    const settings = db.prepare(
      "SELECT enabled, revision, updated_at FROM mailing_list_sync_settings WHERE mailing_list_id = ?",
    );
    expect(settings.get(list.id)).toEqual({ enabled: 0, revision: 3, updated_at: timestamp });
    db.prepare("INSERT INTO mailing_list_sync_settings (mailing_list_id, updated_at) VALUES (?, ?)").run(
      "sibling-list",
      timestamp,
    );
    expect(settings.get("sibling-list")).toEqual({ enabled: 1, revision: 0, updated_at: timestamp });
    db.prepare("UPDATE mailing_list_sync_settings SET enabled = 1, revision = 4 WHERE mailing_list_id = ?").run(
      list.id,
    );
    expect(settings.get("sibling-list")?.enabled).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

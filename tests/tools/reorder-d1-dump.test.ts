import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { unstable_splitSqlQuery } from "wrangler";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

// The saved retention row already contains the effect of the event-insert trigger.
// An interleaved export also lists its referenced table after its first INSERT.
const dump = `
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=ON;
CREATE TABLE retention (event_id TEXT PRIMARY KEY REFERENCES events(id), note TEXT NOT NULL);
INSERT INTO retention VALUES ('saved-event', 'saved; retention');
CREATE TABLE events (id TEXT PRIMARY KEY);
CREATE UNIQUE INDEX retention_note ON retention(note);
CREATE VIEW retained_events AS SELECT event_id,note FROM retention;
CREATE TRIGGER event_retention AFTER INSERT ON events
BEGIN
  INSERT INTO retention VALUES (NEW.id, 'generated ' || NEW.id);
END;
INSERT INTO events VALUES ('saved-event');
`;

describe("D1 dump restore ordering", () => {
  it("preserves saved effects and constraints, then installs triggers for future writes", () => {
    const directory = mkdtempSync(path.join(process.env.PKIC_TEST_TEMP_ROOT ?? tmpdir(), "d1-dump-order-test-"));
    const file = path.join(directory, "backup.sql");
    const database = new DatabaseSync(":memory:");
    try {
      writeFileSync(file, dump);
      execFileSync(process.execPath, [path.join(root, "scripts/reorder-d1-dump.mjs"), file], { cwd: root });
      const ordered = readFileSync(file, "utf8");
      const statements = (sql: string) =>
        unstable_splitSqlQuery(sql)
          .map((statement) => statement.trim())
          .sort();
      expect(statements(ordered)).toEqual(statements(dump));
      expect(ordered.indexOf("CREATE TABLE events")).toBeLessThan(ordered.indexOf("INSERT INTO retention"));
      expect(ordered.indexOf("CREATE TRIGGER event_retention")).toBeGreaterThan(ordered.indexOf("INSERT INTO events"));

      database.exec("PRAGMA foreign_keys=ON; BEGIN");
      database.exec(ordered);
      database.exec("COMMIT");
      expect(database.prepare("SELECT * FROM retained_events").all()).toEqual([
        { event_id: "saved-event", note: "saved; retention" },
      ]);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      database.exec("INSERT INTO events VALUES ('future-event')");
      expect(database.prepare("SELECT note FROM retention WHERE event_id='future-event'").get()).toEqual({
        note: "generated future-event",
      });
      expect(() => database.exec("INSERT INTO retention VALUES ('saved-event', 'duplicate')")).toThrow(
        /UNIQUE constraint failed/,
      );
      database.exec("PRAGMA defer_foreign_keys=OFF");
      expect(() => database.exec("INSERT INTO retention VALUES ('missing-event', 'invalid')")).toThrow(
        /FOREIGN KEY constraint failed/,
      );
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

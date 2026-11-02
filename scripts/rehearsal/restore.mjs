import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Restore only a freshly provisioned rehearsal database, with Wrangler stopped. */
export function restoreRehearsalDump(state, dump) {
  // Let Wrangler choose the database filename. Fail closed if its persistence
  // layout changes or this directory contains more than one database.
  const directory = path.join(state, "v3", "d1", "miniflare-D1DatabaseObject");
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".sqlite") && file !== "metadata.sqlite");
  if (files.length !== 1) throw new Error("Expected exactly one provisioned local rehearsal database");
  const database = new DatabaseSync(path.join(directory, files[0]));
  try {
    const existing = database
      .prepare("SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'")
      .all();
    if (existing.length) throw new Error("Refusing to restore over an existing rehearsal schema");
    // Exported row literals can exceed D1's 100 KB statement limit. Import
    // directly into the offline local SQLite file without changing their values.
    // Keep foreign keys deferred across the whole reordered snapshot, just as
    // Wrangler's single D1 batch did; triggers are installed after the data.
    database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON;");
    try {
      database.exec(fs.readFileSync(dump, "utf8"));
      if (database.prepare("PRAGMA foreign_key_check").get()) {
        throw new Error("Rehearsal dump contains foreign key violations");
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    database.close();
  }
}

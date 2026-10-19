import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../../assets/shared/schemas/permissions";

describe("access-control migration permission snapshot", () => {
  it("seeds the canonical permission vocabulary for the admin role", () => {
    const db = new DatabaseSync(":memory:");
    try {
      // Verify applied history and additive seeds, regardless of their SQL syntax.
      for (const file of fs
        .readdirSync("migrations")
        .filter((name) => name.endsWith(".sql") && !name.startsWith("._"))
        .sort())
        db.exec(fs.readFileSync(path.resolve("migrations", file), "utf8"));
      const seeded = db
        .prepare("SELECT permission FROM role_permissions WHERE role_id='role-admin'")
        .all()
        .map((row) => row.permission);
      expect(new Set(seeded)).toEqual(new Set(PERMISSIONS));
      expect(seeded).toHaveLength(PERMISSIONS.length);
    } finally {
      db.close();
    }
  });
});

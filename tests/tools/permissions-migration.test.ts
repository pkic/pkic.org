import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../../assets/shared/schemas/permissions";

describe("access-control migration permission snapshot", () => {
  it("seeds the canonical permission vocabulary for the admin role", () => {
    const migration = fs.readFileSync(path.resolve("migrations/0035_membership_portal_governance.sql"), "utf8");
    const accessControlSection = migration.match(
      /-- Section: Fine-Grained Access Control([\s\S]*?)-- Section: Passkey Authentication/,
    )?.[1];
    expect(accessControlSection).toBeDefined();
    const permissionSeed = accessControlSection!.match(
      /INSERT INTO role_permissions[\s\S]*?VALUES([\s\S]*?)-- ── Backfill:/,
    )?.[1];
    expect(permissionSeed).toBeDefined();
    const seeded = Array.from(permissionSeed!.matchAll(/'role-admin', '([^']+)'/g), (match) => match[1]);

    expect(new Set(seeded)).toEqual(new Set(PERMISSIONS));
    expect(seeded).toHaveLength(PERMISSIONS.length);
  });
});

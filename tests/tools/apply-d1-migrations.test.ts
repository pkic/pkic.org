import { describe, expect, it } from "vitest";
import { buildImportSql, pendingMigrationNames } from "../../scripts/apply-d1-migrations.mjs";

describe("remote D1 migration import", () => {
  it("records migration 0035 in the same SQL import as its schema changes", () => {
    expect(buildImportSql("CREATE TABLE sample (id TEXT);\n")).toBe(
      "CREATE TABLE sample (id TEXT);\nINSERT INTO d1_migrations (name) VALUES ('0035_membership_portal_governance.sql');\n",
    );
  });

  it("requires earlier migrations before the exceptional import", () => {
    expect(
      pendingMigrationNames(["0034_previous.sql"], ["0034_previous.sql", "0035_membership_portal_governance.sql"]),
    ).toEqual(["0035_membership_portal_governance.sql"]);
  });
});

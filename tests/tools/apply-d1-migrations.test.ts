import { describe, expect, it } from "vitest";
import { buildImportSql, pendingMigrationNames, remoteD1Args } from "../../scripts/apply-d1-migrations.mjs";

describe("remote D1 migration import", () => {
  it("records migration 0035 in the same SQL import as its schema changes", () => {
    expect(buildImportSql("CREATE TABLE sample (id TEXT);\n")).toBe(
      "CREATE TABLE sample (id TEXT);\nINSERT INTO d1_migrations (name) VALUES ('0035_membership_portal_governance.sql');\n",
    );
  });

  it("records retirement migration 0037 alongside its trigger and column cutover", () => {
    expect(buildImportSql("ALTER TABLE users DROP COLUMN role;", "0037_retire_legacy_account_role.sql")).toBe(
      "ALTER TABLE users DROP COLUMN role;\nINSERT INTO d1_migrations (name) VALUES ('0037_retire_legacy_account_role.sql');\n",
    );
  });

  it("addresses the shared Preview database through the DB binding's preview database", () => {
    expect(remoteD1Args("preview")).toEqual(["DB", "--env", "production", "--preview", "--remote"]);
    expect(remoteD1Args("production")).toEqual(["DB", "--env", "production", "--remote"]);
    expect(() => remoteD1Args("staging")).toThrow(/Unsupported Wrangler target/);
  });

  it("requires earlier migrations before the exceptional import", () => {
    expect(
      pendingMigrationNames(["0034_previous.sql"], ["0034_previous.sql", "0035_membership_portal_governance.sql"]),
    ).toEqual(["0035_membership_portal_governance.sql"]);
  });
});

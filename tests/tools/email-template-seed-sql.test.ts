import { describe, expect, it } from "vitest";
import { buildTemplateSqlStatements } from "../../scripts/lib/email-template-seed-sql.mjs";

const template = {
  key: "welcome",
  subjectTemplate: " Welcome {{name}} ",
  content: "Hello {{name}}",
  contentType: "markdown",
};

describe("buildTemplateSqlStatements", () => {
  it("guards missing-only seeds without archiving the active version", () => {
    const sql = buildTemplateSqlStatements({ adminEmail: " Admin@Example.test ", ifMissing: true }, [template]);
    expect(sql).toContain("WHERE NOT EXISTS");
    expect(sql).not.toContain("SET status = 'archived'");
    expect(sql).toContain("'admin@example.test'");
    expect(sql).toContain("' Welcome {{name}} '");
  });

  it("archives the prior active version before inserting a replacement", () => {
    const sql = buildTemplateSqlStatements({ adminEmail: "admin@example.test", ifMissing: false }, [template]);
    expect(sql).toContain("SET status = 'archived'");
    expect(sql).not.toContain("WHERE NOT EXISTS");
    expect(sql.indexOf("UPDATE email_template_versions")).toBeLessThan(
      sql.indexOf("INSERT INTO email_template_versions"),
    );
  });
});

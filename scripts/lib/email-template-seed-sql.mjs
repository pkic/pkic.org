import { createHash, randomUUID } from "node:crypto";
import { sqlString, toSqlNullableTextPreservingWhitespace } from "./sql.mjs";

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildTemplateVersionInsert(template, normalizedAdminEmail, onlyWhenMissing) {
  const missingGuard = onlyWhenMissing
    ? `
WHERE NOT EXISTS (
  SELECT 1
  FROM email_template_versions
  WHERE template_key = ${sqlString(template.key)}
    AND status = 'active'
)`
    : "";

  return `
INSERT INTO email_template_versions (
  id, template_key, version, subject_template, body, content_type, r2_object_key,
  checksum_sha256, status, created_by_user_id, created_at
)
SELECT
  ${sqlString(randomUUID())},
  ${sqlString(template.key)},
  COALESCE((SELECT MAX(version) FROM email_template_versions WHERE template_key = ${sqlString(template.key)}), 0) + 1,
  ${toSqlNullableTextPreservingWhitespace(template.subjectTemplate)},
  ${sqlString(template.content)},
  ${sqlString(template.contentType ?? "markdown")},
  NULL,
  ${sqlString(sha256Hex(template.content))},
  'active',
  (SELECT id FROM users WHERE normalized_email = ${sqlString(normalizedAdminEmail)} LIMIT 1),
  datetime('now')${missingGuard};
`;
}

/** Render idempotent or version-replacing email-template seed SQL. */
export function buildTemplateSqlStatements(cli, templates) {
  const statements = [];
  const normalizedAdminEmail = cli.adminEmail.trim().toLowerCase();

  for (const template of templates) {
    if (!cli.ifMissing) {
      statements.push(`
UPDATE email_template_versions
SET status = 'archived'
WHERE template_key = ${sqlString(template.key)} AND status = 'active';
`);
    }
    statements.push(buildTemplateVersionInsert(template, normalizedAdminEmail, cli.ifMissing));
  }

  return statements.join("\n");
}

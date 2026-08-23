import {
  ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS,
  adminEmailTemplateVersionRowSchema,
  adminEmailTemplatesListResponseSchema,
  adminEmailTemplateVersionsListResponseSchema,
  type EmailTemplatesListQuery,
  type EmailTemplateVersionsListQuery,
  type AdminEmailTemplateVersion,
  type AdminEmailTemplateVersionInput,
} from "../../../assets/shared/schemas/admin-email-templates";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy, resolveOrderBy } from "../db/sort";
import { adminDatabaseUserId } from "../auth/admin-identity";
import { buildTemplateVersionCreate } from "../email/templates";
import type { AuthAdmin, DatabaseLike } from "../types";
import { prepareAuditLog } from "./audit";

interface TemplateSummaryRow {
  template_key: string;
  active_version: number | null;
  version_count: number;
  draft_count: number;
}

export async function createAdminEmailTemplateVersion(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: AdminEmailTemplateVersionInput & { templateKey: string },
) {
  const prepared = await buildTemplateVersionCreate(db, {
    ...input,
    createdByUserId: adminDatabaseUserId(actor),
  });
  await db.batch([
    prepared.statement,
    prepareAuditLog(
      db,
      "admin",
      actor.id,
      "email_template_version_created",
      "email_template_version",
      prepared.row.id,
      {
        templateKey: prepared.row.template_key,
        version: prepared.row.version,
        contentType: prepared.row.content_type,
        messageType: prepared.row.message_type,
      },
      prepared.row.created_at,
    ),
  ]);
  return prepared.row;
}

export async function listAdminEmailTemplates(db: DatabaseLike, query: EmailTemplatesListQuery) {
  const orderBy = resolveOrderBy(
    query.sort,
    ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS,
    "ORDER BY template_key ASC",
    "template_key ASC",
  );
  const search = query.q ? buildD1TextSearchFilter(query.q, ["template_key"]) : null;
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.templateKeyPrefix) {
    conditions.push("template_key GLOB ?");
    bindings.push(`${query.templateKeyPrefix}*`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows: templates, total } = await queryPage<TemplateSummaryRow>(db, {
    sql: `SELECT
         template_key,
         MAX(CASE WHEN status = 'active' THEN version END) AS active_version,
         COUNT(*) AS version_count,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_count
       FROM email_template_versions
       ${where}
       GROUP BY template_key`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  return adminEmailTemplatesListResponseSchema.parse({
    templates,
    page: buildPageInfo(query.limit, query.offset, total, templates.length),
  });
}

export async function listAdminEmailTemplateVersions(
  db: DatabaseLike,
  templateKey: string,
  query: EmailTemplateVersionsListQuery,
) {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["subject_template", "status", "content_type", "message_type"])
    : null;
  const conditions: string[] = ["template_key = ?"];
  const bindings: unknown[] = [templateKey];
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.status) {
    conditions.push("status = ?");
    bindings.push(query.status);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      version: "version",
      status: "status COLLATE NOCASE",
      createdAt: "created_at",
    },
    "version DESC",
    "id ASC",
  );
  const { rows, total } = await queryPage<AdminEmailTemplateVersion>(db, {
    sql: `SELECT
         id,
         template_key,
         version,
         subject_template,
         body,
         content_type,
         r2_object_key,
         checksum_sha256,
         status,
         created_by_user_id,
         created_at,
         message_type
       FROM email_template_versions
       ${where}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  const versions = rows.map((version) => adminEmailTemplateVersionRowSchema.parse(version));
  return adminEmailTemplateVersionsListResponseSchema.parse({
    versions,
    page: buildPageInfo(query.limit, query.offset, total, versions.length),
  });
}

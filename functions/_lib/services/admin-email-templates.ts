import {
  ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS,
  type AdminEmailTemplateVersion,
} from "../../../assets/shared/schemas/admin-email-templates";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy, resolveOrderBy } from "../db/sort";
import type { DatabaseLike } from "../types";

interface TemplateSummaryRow {
  template_key: string;
  active_version: number | null;
  version_count: number;
  draft_count: number;
}

interface ListQuery {
  q?: string;
  sort?: string;
  limit: number;
  offset: number;
}

export async function listAdminEmailTemplates(db: DatabaseLike, query: ListQuery) {
  const orderBy = resolveOrderBy(
    query.sort,
    ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS,
    "ORDER BY template_key ASC",
    "template_key ASC",
  );
  const search = query.q ? buildD1TextSearchFilter(query.q, ["template_key"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const bindings = search?.bindings ?? [];
  const { rows: templates, total } = await queryPage<TemplateSummaryRow>(
    db,
    {
      sql: `SELECT
         template_key,
         MAX(CASE WHEN status = 'active' THEN version END) AS active_version,
         COUNT(*) AS version_count,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_count
       FROM email_template_versions
       ${where}
       GROUP BY template_key
       ${orderBy}
       LIMIT ? OFFSET ?`,
      bindings: [...bindings, query.limit, query.offset],
    },
    {
      sql: `SELECT COUNT(DISTINCT template_key) AS total FROM email_template_versions ${where}`,
      bindings,
    },
  );
  return {
    templates,
    page: buildPageInfo(query.limit, query.offset, total, templates.length),
  };
}

export async function listAdminEmailTemplateVersions(db: DatabaseLike, templateKey: string, query: ListQuery) {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["subject_template", "status", "content_type", "message_type"])
    : null;
  const searchSql = search ? `AND ${search.sql}` : "";
  const bindings = [templateKey, ...(search?.bindings ?? [])];
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
  const { rows: versions, total } = await queryPage<AdminEmailTemplateVersion>(
    db,
    {
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
       WHERE template_key = ?
       ${searchSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      bindings: [...bindings, query.limit, query.offset],
    },
    {
      sql: `SELECT COUNT(*) AS total
            FROM email_template_versions
            WHERE template_key = ?
            ${searchSql}`,
      bindings,
    },
  );
  return {
    versions,
    page: buildPageInfo(query.limit, query.offset, total, versions.length),
  };
}

import {
  EMAIL_TEMPLATES_SORT_COLUMNS,
  emailTemplateVersionRowSchema,
  emailTemplatesListResponseSchema,
  emailTemplateVersionsListResponseSchema,
  type EmailTemplatesListQuery,
  type EmailTemplateVersionsListQuery,
  type EmailTemplateVersion,
  type EmailTemplateVersionInput,
} from "../../../assets/shared/schemas/email-templates";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy, resolveOrderBy } from "../db/sort";
import { buildTemplateVersionCreate } from "../email/templates";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";

interface TemplateSummaryRow {
  template_key: string;
  active_version: number | null;
  version_count: number;
  draft_count: number;
}

export async function createEmailTemplateVersion(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: EmailTemplateVersionInput & { templateKey: string },
) {
  const prepared = await buildTemplateVersionCreate(db, {
    ...input,
    createdByUserId: actor.id,
  });
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "email-templates:write" }]),
      prepared.statement,
      prepareAuditLogAfterOneChange(
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
  } catch (error) {
    throwEmailTemplateVersionCreateError(error);
  }
  return prepared.row;
}

export async function listEmailTemplates(db: DatabaseLike, query: EmailTemplatesListQuery) {
  const orderBy = resolveOrderBy(
    query.sort,
    EMAIL_TEMPLATES_SORT_COLUMNS,
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
  return emailTemplatesListResponseSchema.parse({
    templates,
    page: buildPageInfo(query.limit, query.offset, total, templates.length),
  });
}

interface TemplateActivationSnapshot {
  id: string;
  template_key: string;
  version: number;
  status: "draft" | "active" | "archived";
  checksum_sha256: string;
}

function throwEmailTemplateVersionCreateError(error: unknown): never {
  if (isAuthorizationGuardFailure(error)) {
    throw new AppError(
      409,
      "EMAIL_TEMPLATE_AUTHORIZATION_CHANGED",
      "Email-template permission changed while the update was being saved",
    );
  }
  if (isAuditChangeGuardFailure(error)) {
    throw new AppError(409, "EMAIL_TEMPLATE_STATE_CHANGED", "Template state changed; reload and retry");
  }
  throw error;
}

export async function activateEmailTemplateVersion(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  templateKey: string,
  version: number,
): Promise<void> {
  const target = await first<TemplateActivationSnapshot>(
    db,
    `SELECT id, template_key, version, status, checksum_sha256
       FROM email_template_versions
      WHERE template_key = ? AND version = ?`,
    [templateKey, version],
  );
  if (!target) throw new AppError(404, "EMAIL_TEMPLATE_VERSION_NOT_FOUND", "Template version not found");

  const previousActive = await first<TemplateActivationSnapshot>(
    db,
    `SELECT id, template_key, version, status, checksum_sha256
       FROM email_template_versions
      WHERE template_key = ? AND status = 'active'
      ORDER BY version DESC
      LIMIT 1`,
    [templateKey],
  );
  const changedAt = nowIso();
  const archivePrevious =
    previousActive && previousActive.id !== target.id
      ? [
          db
            .prepare(
              `UPDATE email_template_versions
                  SET status = 'archived'
                WHERE id = ? AND template_key = ? AND status = 'active'`,
            )
            .bind(previousActive.id, templateKey),
        ]
      : [];

  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "email-templates:write" }]),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1
                FROM email_template_versions target
               WHERE target.id = ?
                 AND target.template_key = ?
                 AND target.version = ?
                 AND target.status = ?
                 AND COALESCE((
                   SELECT active.id
                     FROM email_template_versions active
                    WHERE active.template_key = target.template_key
                      AND active.status = 'active'
                    ORDER BY active.version DESC
                    LIMIT 1
                 ), '') = ?
                 AND (
                   SELECT COUNT(*)
                     FROM email_template_versions active_count
                    WHERE active_count.template_key = target.template_key
                      AND active_count.status = 'active'
                 ) <= 1`,
        bindings: [target.id, target.template_key, target.version, target.status, previousActive?.id ?? ""],
      }),
      ...archivePrevious,
      db
        .prepare(
          `UPDATE email_template_versions
              SET status = 'active'
            WHERE id = ? AND template_key = ? AND version = ?`,
        )
        .bind(target.id, templateKey, version),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "email_template_version_activated",
        "email_template_version",
        target.id,
        {
          templateKey,
          version,
          checksumSha256: target.checksum_sha256,
          previousActiveVersion: previousActive?.version ?? null,
        },
        changedAt,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "EMAIL_TEMPLATE_ACTIVATION_CONFLICT",
        "Template state or permission changed while the version was being activated; reload and retry",
      );
    }
    throw error;
  }
}

export async function listEmailTemplateVersions(
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
  const { rows, total } = await queryPage<EmailTemplateVersion>(db, {
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
  const versions = rows.map((version) => emailTemplateVersionRowSchema.parse(version));
  return emailTemplateVersionsListResponseSchema.parse({
    versions,
    page: buildPageInfo(query.limit, query.offset, total, versions.length),
  });
}

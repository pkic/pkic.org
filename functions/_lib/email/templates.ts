import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { sha256Hex } from "../utils/crypto";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import type { DatabaseLike, StatementLike } from "../types";
import type { EmailContentType, EmailMessageType } from "../../../assets/shared/schemas/admin-email-templates";

const TEMPLATE_CACHE_TTL_MS = 60_000;

export interface ResolvedEmailTemplate {
  version: number;
  content: string;
  contentType: string;
  subjectTemplate: string | null;
  messageType: EmailMessageType;
}

export type EmailTemplateResolution =
  | { ok: true; template: ResolvedEmailTemplate }
  | { ok: false; code: "EMAIL_TEMPLATE_NOT_FOUND" | "EMAIL_TEMPLATE_MISSING_BODY"; message: string };

interface CachedTemplateResolution {
  expiresAt: number;
  value: ResolvedEmailTemplate | null;
}

const activeTemplateCache = new Map<string, CachedTemplateResolution>();

export function invalidateTemplateCache(templateKey?: string): void {
  if (templateKey) {
    activeTemplateCache.delete(templateKey);
    return;
  }

  activeTemplateCache.clear();
}

export interface TemplateVersionRow {
  id: string;
  template_key: string;
  version: number;
  subject_template: string | null;
  /** Template body stored in the DB. */
  body: string | null;
  /** Format of the body: 'markdown' | 'html' | 'text'. Defaults to 'markdown'. */
  content_type: EmailContentType;
  /** Delivery classification used as the default when this template is selected in send forms. */
  message_type: EmailMessageType;
  /** Deprecated: legacy R2 key (kept for backward compatibility, no longer used). */
  r2_object_key: string | null;
  checksum_sha256: string;
  status: "draft" | "active" | "archived";
  created_by_user_id: string | null;
  created_at: string;
}

const TEMPLATE_VERSION_COLUMNS =
  "id, template_key, version, subject_template, body, content_type, message_type, r2_object_key, " +
  "checksum_sha256, status, created_by_user_id, created_at";

export async function listTemplateVersions(db: DatabaseLike): Promise<TemplateVersionRow[]> {
  return all<TemplateVersionRow>(
    db,
    `SELECT ${TEMPLATE_VERSION_COLUMNS} FROM email_template_versions
     ORDER BY template_key ASC, version DESC`,
  );
}

export async function templateKeyExists(db: DatabaseLike, templateKey: string): Promise<boolean> {
  const row = await first<{ n: number }>(
    db,
    "SELECT 1 AS n FROM email_template_versions WHERE template_key = ? LIMIT 1",
    [templateKey],
  );
  return row !== null;
}

async function getNextVersion(db: DatabaseLike, templateKey: string): Promise<number> {
  const row = await first<{ max_version: number }>(
    db,
    "SELECT MAX(version) AS max_version FROM email_template_versions WHERE template_key = ?",
    [templateKey],
  );
  return Number(row?.max_version ?? 0) + 1;
}

export interface TemplateVersionCreateInput {
  templateKey: string;
  content: string;
  contentType?: EmailContentType;
  subjectTemplate?: string | null;
  messageType?: EmailMessageType | null;
  createdByUserId: string | null;
}

export async function buildTemplateVersionCreate(
  db: DatabaseLike,
  payload: TemplateVersionCreateInput,
): Promise<{ row: TemplateVersionRow; statement: StatementLike }> {
  const version = await getNextVersion(db, payload.templateKey);
  const checksum = await sha256Hex(payload.content);

  const row: TemplateVersionRow = {
    id: uuid(),
    template_key: payload.templateKey,
    version,
    subject_template: payload.subjectTemplate ?? null,
    body: payload.content,
    content_type: payload.contentType ?? "markdown",
    message_type: payload.messageType ?? "transactional",
    r2_object_key: null,
    checksum_sha256: checksum,
    status: "draft",
    created_by_user_id: payload.createdByUserId,
    created_at: nowIso(),
  };

  const statement = db
    .prepare(
      `INSERT INTO email_template_versions (
        id, template_key, version, subject_template, body, content_type, message_type, r2_object_key,
        checksum_sha256, status, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.template_key,
      row.version,
      row.subject_template,
      row.body,
      row.content_type,
      row.message_type,
      row.r2_object_key,
      row.checksum_sha256,
      row.status,
      row.created_by_user_id,
      row.created_at,
    );

  return { row, statement };
}

export async function createTemplateVersion(
  db: DatabaseLike,
  payload: TemplateVersionCreateInput,
): Promise<TemplateVersionRow> {
  const prepared = await buildTemplateVersionCreate(db, payload);
  await prepared.statement.run();
  return prepared.row;
}

export async function activateTemplateVersion(
  db: DatabaseLike,
  payload: { templateKey: string; version: number },
): Promise<void> {
  const target = await first<TemplateVersionRow>(
    db,
    `SELECT ${TEMPLATE_VERSION_COLUMNS} FROM email_template_versions WHERE template_key = ? AND version = ?`,
    [payload.templateKey, payload.version],
  );

  if (!target) {
    throw new AppError(404, "EMAIL_TEMPLATE_VERSION_NOT_FOUND", "Template version not found");
  }

  await run(db, "UPDATE email_template_versions SET status = 'archived' WHERE template_key = ? AND status = 'active'", [
    payload.templateKey,
  ]);

  await run(db, "UPDATE email_template_versions SET status = 'active' WHERE template_key = ? AND version = ?", [
    payload.templateKey,
    payload.version,
  ]);

  invalidateTemplateCache(payload.templateKey);
}

export async function resolveTemplateSet(
  db: DatabaseLike,
  requestedTemplateKeys: readonly string[],
): Promise<Map<string, EmailTemplateResolution>> {
  const templateKeys = [...new Set(requestedTemplateKeys)];
  const resolutions = new Map<string, EmailTemplateResolution>();
  const unresolvedKeys: string[] = [];
  const now = Date.now();

  for (const templateKey of templateKeys) {
    const cached = activeTemplateCache.get(templateKey);
    if (!cached || cached.expiresAt <= now) {
      unresolvedKeys.push(templateKey);
    } else if (cached.value) {
      resolutions.set(templateKey, { ok: true, template: cached.value });
    } else {
      resolutions.set(templateKey, {
        ok: false,
        code: "EMAIL_TEMPLATE_NOT_FOUND",
        message: `No template configured for key '${templateKey}'`,
      });
    }
  }

  if (unresolvedKeys.length > 0) {
    const activeRows = await all<TemplateVersionRow>(
      db,
      `WITH requested AS (
         SELECT CAST(value AS TEXT) AS template_key FROM json_each(?)
       ),
       ranked AS (
         SELECT etv.id, etv.template_key, etv.version, etv.subject_template, etv.body,
                etv.content_type, etv.message_type, etv.r2_object_key, etv.checksum_sha256,
                etv.status, etv.created_by_user_id, etv.created_at,
                ROW_NUMBER() OVER (PARTITION BY etv.template_key ORDER BY etv.version DESC) AS active_rank
         FROM email_template_versions etv
         JOIN requested r ON r.template_key = etv.template_key
         WHERE etv.status = 'active'
       )
       SELECT id, template_key, version, subject_template, body, content_type, message_type,
              r2_object_key, checksum_sha256, status, created_by_user_id, created_at
       FROM ranked WHERE active_rank = 1`,
      [JSON.stringify(unresolvedKeys)],
    );
    const activeByKey = new Map(activeRows.map((row) => [row.template_key, row]));

    for (const templateKey of unresolvedKeys) {
      const active = activeByKey.get(templateKey);
      if (!active) {
        activeTemplateCache.set(templateKey, { expiresAt: now + TEMPLATE_CACHE_TTL_MS, value: null });
        resolutions.set(templateKey, {
          ok: false,
          code: "EMAIL_TEMPLATE_NOT_FOUND",
          message: `No template configured for key '${templateKey}'`,
        });
      } else if (!active.body) {
        resolutions.set(templateKey, {
          ok: false,
          code: "EMAIL_TEMPLATE_MISSING_BODY",
          message: `Template '${templateKey}' v${active.version} has no body content`,
        });
      } else {
        const template: ResolvedEmailTemplate = {
          version: active.version,
          content: active.body,
          contentType: active.content_type ?? "markdown",
          subjectTemplate: active.subject_template,
          messageType: active.message_type ?? "transactional",
        };
        activeTemplateCache.set(templateKey, { expiresAt: now + TEMPLATE_CACHE_TTL_MS, value: template });
        resolutions.set(templateKey, { ok: true, template });
      }
    }
  }

  return resolutions;
}

export async function resolveTemplates(
  db: DatabaseLike,
  templateKeys: readonly string[],
): Promise<Map<string, ResolvedEmailTemplate>> {
  const resolutions = await resolveTemplateSet(db, templateKeys);
  return requireResolvedTemplates(resolutions, templateKeys);
}

export function requireResolvedTemplates(
  resolutions: ReadonlyMap<string, EmailTemplateResolution>,
  templateKeys: readonly string[],
): Map<string, ResolvedEmailTemplate> {
  const templates = new Map<string, ResolvedEmailTemplate>();
  for (const templateKey of new Set(templateKeys)) {
    const resolution = resolutions.get(templateKey);
    if (!resolution || !resolution.ok) {
      const code = resolution?.code ?? "EMAIL_TEMPLATE_NOT_FOUND";
      throw new AppError(
        code === "EMAIL_TEMPLATE_NOT_FOUND" ? 404 : 500,
        code,
        resolution?.message ?? "Template missing",
      );
    }
    templates.set(templateKey, resolution.template);
  }
  return templates;
}

export async function resolveTemplate(db: DatabaseLike, templateKey: string): Promise<ResolvedEmailTemplate> {
  const templates = await resolveTemplates(db, [templateKey]);
  return templates.get(templateKey)!;
}

import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { sha256Hex } from "../utils/crypto";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";

const TEMPLATE_CACHE_TTL_MS = 60_000;

interface CachedTemplateResolution {
  expiresAt: number;
  value: {
    version: number;
    content: string;
    contentType: string;
    subjectTemplate: string | null;
  } | null;
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
  content_type: "markdown" | "html" | "text";
  /** Deprecated: legacy R2 key (kept for backward compatibility, no longer used). */
  r2_object_key: string | null;
  checksum_sha256: string;
  status: "draft" | "active" | "archived";
  created_by_user_id: string | null;
  created_at: string;
}

export async function listTemplateVersions(db: DatabaseLike): Promise<TemplateVersionRow[]> {
  return all<TemplateVersionRow>(
    db,
    `SELECT * FROM email_template_versions
     ORDER BY template_key ASC, version DESC`,
  );
}

async function getNextVersion(db: DatabaseLike, templateKey: string): Promise<number> {
  const row = await first<{ max_version: number }>(
    db,
    "SELECT MAX(version) AS max_version FROM email_template_versions WHERE template_key = ?",
    [templateKey],
  );
  return Number(row?.max_version ?? 0) + 1;
}

export async function createTemplateVersion(
  db: DatabaseLike,
  payload: {
    templateKey: string;
    content: string;
    contentType?: "markdown" | "html" | "text";
    subjectTemplate?: string | null;
    createdByUserId: string;
  },
): Promise<TemplateVersionRow> {
  const version = await getNextVersion(db, payload.templateKey);
  const checksum = await sha256Hex(payload.content);

  const row: TemplateVersionRow = {
    id: uuid(),
    template_key: payload.templateKey,
    version,
    subject_template: payload.subjectTemplate ?? null,
    body: payload.content,
    content_type: payload.contentType ?? "markdown",
    r2_object_key: null,
    checksum_sha256: checksum,
    status: "draft",
    created_by_user_id: payload.createdByUserId,
    created_at: nowIso(),
  };

  await run(
    db,
    `INSERT INTO email_template_versions (
      id, template_key, version, subject_template, body, content_type, r2_object_key,
      checksum_sha256, status, created_by_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.template_key,
      row.version,
      row.subject_template,
      row.body,
      row.content_type,
      row.r2_object_key,
      row.checksum_sha256,
      row.status,
      row.created_by_user_id,
      row.created_at,
    ],
  );

  return row;
}

export async function activateTemplateVersion(
  db: DatabaseLike,
  payload: { templateKey: string; version: number },
): Promise<void> {
  const target = await first<TemplateVersionRow>(
    db,
    "SELECT * FROM email_template_versions WHERE template_key = ? AND version = ?",
    [payload.templateKey, payload.version],
  );

  if (!target) {
    throw new AppError(404, "EMAIL_TEMPLATE_VERSION_NOT_FOUND", "Template version not found");
  }

  await run(
    db,
    "UPDATE email_template_versions SET status = 'archived' WHERE template_key = ? AND status = 'active'",
    [payload.templateKey],
  );

  await run(
    db,
    "UPDATE email_template_versions SET status = 'active' WHERE template_key = ? AND version = ?",
    [payload.templateKey, payload.version],
  );

  invalidateTemplateCache(payload.templateKey);
}

export async function resolveTemplate(
  db: DatabaseLike,
  templateKey: string,
): Promise<{ version: number; content: string; contentType: string; subjectTemplate: string | null }> {
  const cached = activeTemplateCache.get(templateKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.value) {
      return cached.value;
    }

    throw new AppError(404, "EMAIL_TEMPLATE_NOT_FOUND", `No template configured for key '${templateKey}'`);
  }

  const active = await first<TemplateVersionRow>(
    db,
    `SELECT * FROM email_template_versions
     WHERE template_key = ? AND status = 'active'
     ORDER BY version DESC LIMIT 1`,
    [templateKey],
  );

  if (!active) {
    throw new AppError(404, "EMAIL_TEMPLATE_NOT_FOUND", `No template configured for key '${templateKey}'`);
  }

  if (!active.body) {
    throw new AppError(500, "EMAIL_TEMPLATE_MISSING_BODY", `Template '${templateKey}' v${active.version} has no body content`);
  }

  const resolved = {
    version: active.version,
    content: active.body,
    contentType: active.content_type ?? "markdown",
    subjectTemplate: active.subject_template,
  };

  activeTemplateCache.set(templateKey, {
    expiresAt: Date.now() + TEMPLATE_CACHE_TTL_MS,
    value: resolved,
  });

  return resolved;
}



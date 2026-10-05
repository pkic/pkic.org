import { preparePublicationDocumentEffectsGuard } from "./site-publication-document-effects";
import { first } from "../db/queries";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../db/authorization-guard";
import { requirePermission, preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import {
  sitePublicationRequestInputSchema,
  sitePublicationResourceSchema,
  sitePublicationRequestQuerySchema,
  sitePublicationRequestSchema,
  sitePublicationDeliverySchema,
  sitePublicationBuildCompletionSchema,
  sitePublicationActivationSchema,
  type SitePublicationRequestInput,
  type SitePublicationResource,
  type SitePublicationRequestQuery,
  type SitePublicationBuildCompletion,
  type SitePublicationActivation,
} from "../../../assets/shared/schemas/site-publication-requests";

/** The caller owns permission/resource/revision guards and includes this statement in its existing atomic mutation. */
export function prepareSitePublicationRequest(db: DatabaseLike, input: SitePublicationRequestInput): StatementLike {
  const value = sitePublicationRequestInputSchema.parse(input),
    now = nowIso();
  return db
    .prepare(
      `INSERT INTO site_publication_requests(id,resource_type,resource_id,revision,reason_code,deduplication_key,document_effects_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(deduplication_key) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      value.resourceType,
      value.resourceId,
      value.revision,
      value.reasonCode,
      value.deduplicationKey,
      JSON.stringify(value.documentEffects),
      now,
      now,
    );
}
export function isSitePublicationRequestConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("SITE_PUBLICATION_REQUEST_KEY_CONFLICT");
}
const requestColumns = `sequence,id,resource_type AS resourceType,resource_id AS resourceId,revision,reason_code AS reasonCode,deduplication_key AS deduplicationKey,status,attempts,created_at AS createdAt,updated_at AS updatedAt,lease_expires_at AS leaseExpiresAt,next_attempt_at AS nextAttemptAt,last_error_code AS lastErrorCode,last_error_at AS lastErrorAt,source_sequence AS sourceSequence,snapshot_id AS snapshotId,build_id AS buildId,release_id AS releaseId,document_effects_json AS documentEffectsJson,document_effects_completed_at AS documentEffectsCompletedAt`;
async function publicationResourceEvent(db: DatabaseLike, resource: SitePublicationResource): Promise<string> {
  const sql =
    resource.resourceType === "event_agenda"
      ? "SELECT id AS event_id FROM events WHERE id=?"
      : resource.resourceType === "presentation_version"
        ? "SELECT proposal.event_id FROM presentation_versions version JOIN session_proposals proposal ON proposal.id=version.proposal_id WHERE version.id=?"
        : "SELECT event_id FROM event_agenda_occurrences WHERE id=?";
  const row = await first<{ event_id: string }>(db, sql, [resource.resourceId]);
  if (!row) throw new AppError(404, "PUBLICATION_RESOURCE_NOT_FOUND", "Resource not found");
  return row.event_id;
}
/** Reads one event-owned aggregate only; never exposes another resource's ledger or worker lease tokens. */
export async function listSitePublicationRequests(
  db: DatabaseLike,
  actor: AuthAdmin,
  resource: SitePublicationResource,
  query: SitePublicationRequestQuery,
) {
  const scope = sitePublicationResourceSchema.parse(resource),
    page = sitePublicationRequestQuerySchema.parse(query);
  const eventId = await publicationResourceEvent(db, scope);
  const requirement = { permission: "agenda:read", context: { type: "event", id: eventId } };
  requirePermission(actor, requirement.permission, requirement.context);
  const where =
    "resource_type=? AND resource_id=? AND (? IS NULL OR status=?) AND INSTR(LOWER(reason_code||' '||deduplication_key),LOWER(?))>0";
  const values = [scope.resourceType, scope.resourceId, page.status ?? null, page.status ?? null, page.q ?? ""];
  try {
    const results = await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [requirement]),
      db.prepare(`SELECT COUNT(*) AS total FROM site_publication_requests WHERE ${where}`).bind(...values),
      db
        .prepare(
          `SELECT ${requestColumns} FROM site_publication_requests WHERE ${where} ORDER BY sequence ${page.sort?.startsWith("-") ? "DESC" : "ASC"} LIMIT ? OFFSET ?`,
        )
        .bind(...values, page.limit, page.offset),
    ]);
    const requests = (results[2]?.results ?? []).map((row) =>
      sitePublicationRequestSchema.parse({ ...row, documentEffects: JSON.parse(String(row.documentEffectsJson)) }),
    );
    const total = Number((results[1]?.results?.[0] as { total?: number } | undefined)?.total ?? 0);
    return { requests, page: buildPageInfo(page.limit, page.offset, total, requests.length) };
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "PUBLICATION_ACCESS_CHANGED", "Publication access changed");
    throw error;
  }
}
export async function getSitePublicationDelivery(db: DatabaseLike) {
  const row = await first(
    db,
    "SELECT desired_sequence AS desiredSequence,delivered_sequence AS deliveredSequence,snapshot_id AS snapshotId,build_id AS buildId,release_id AS releaseId,activation_receipt_id AS activationReceiptId,activated_at AS activatedAt FROM site_publication_delivery_state WHERE id=1",
  );
  if (!row) throw new AppError(503, "PUBLICATION_LEDGER_UNAVAILABLE", "Publication ledger is unavailable");
  return sitePublicationDeliverySchema.parse(row);
}
/** A successful build is awaiting activation; it does not advance delivered state. */
export async function recordSitePublicationBuild(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: SitePublicationBuildCompletion,
) {
  const value = sitePublicationBuildCompletionSchema.parse(input),
    now = nowIso();
  requirePermission(actor, "scheduler:manage");
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "scheduler:manage" }]),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM site_publication_requests request JOIN site_publication_delivery_state state ON state.id=1 WHERE request.id=? AND request.status='rendering' AND request.lease_token=? AND request.lease_expires_at>? AND request.sequence<=? AND state.desired_sequence>=?",
        bindings: [value.requestId, value.leaseToken, now, value.sourceSequence, value.sourceSequence],
      }),
      db
        .prepare(
          "UPDATE site_publication_requests SET status='awaiting_activation',source_sequence=?,snapshot_id=?,build_id=?,release_id=?,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
        )
        .bind(value.sourceSequence, value.snapshotId, value.buildId, value.releaseId, now, value.requestId),
      prepareAuditLog(
        db,
        actor.identityType,
        actor.id,
        "site.publication.build.completed",
        "site_publication_request",
        value.requestId,
        { sourceSequence: value.sourceSequence, buildId: value.buildId, releaseId: value.releaseId },
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(409, "PUBLICATION_BUILD_CHANGED", "Publication build lease or authority changed");
    throw error;
  }
  return getSitePublicationDelivery(db);
}
/** Trusted activators must verify the actual deployment receipt and full snapshot coverage before calling. */
export async function recordSitePublicationActivation(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: SitePublicationActivation,
) {
  const value = sitePublicationActivationSchema.parse(input),
    now = nowIso();
  requirePermission(actor, "scheduler:manage");
  try {
    await db.batch([preparePermissionsAuthorizationGuard(db, actor, [{ permission: "scheduler:manage" }])]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "PUBLICATION_ACCESS_CHANGED", "Publication access changed");
    throw error;
  }
  const existing = await first<{
    request_id: string;
    source_sequence: number;
    snapshot_id: string;
    build_id: string;
    release_id: string;
    activated_at: string;
  }>(
    db,
    "SELECT request_id,source_sequence,snapshot_id,build_id,release_id,activated_at FROM site_publication_activation_receipts WHERE id=?",
    [value.activationReceiptId],
  );
  if (existing) {
    if (
      existing.request_id !== value.requestId ||
      existing.source_sequence !== value.sourceSequence ||
      existing.snapshot_id !== value.snapshotId ||
      existing.build_id !== value.buildId ||
      existing.release_id !== value.releaseId ||
      existing.activated_at !== value.activatedAt
    )
      throw new AppError(
        409,
        "PUBLICATION_ACTIVATION_CONFLICT",
        "Activation receipt identity already belongs to another delivery",
      );
    return getSitePublicationDelivery(db);
  }
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "scheduler:manage" }]),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM site_publication_requests request JOIN site_publication_delivery_state state ON state.id=1 WHERE request.id=? AND request.status='awaiting_activation' AND request.source_sequence=? AND request.snapshot_id=? AND request.build_id=? AND request.release_id=? AND state.delivered_sequence=? AND ? > state.delivered_sequence AND ? <= state.desired_sequence",
        bindings: [
          value.requestId,
          value.sourceSequence,
          value.snapshotId,
          value.buildId,
          value.releaseId,
          value.expectedDeliveredSequence,
          value.sourceSequence,
          value.sourceSequence,
        ],
      }),
      preparePublicationDocumentEffectsGuard(db, value.sourceSequence),
      db
        .prepare(
          "INSERT INTO site_publication_activation_receipts(id,request_id,source_sequence,snapshot_id,build_id,release_id,activated_at,recorded_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          value.activationReceiptId,
          value.requestId,
          value.sourceSequence,
          value.snapshotId,
          value.buildId,
          value.releaseId,
          value.activatedAt,
          now,
        ),
      db
        .prepare(
          "UPDATE site_publication_delivery_state SET delivered_sequence=?,snapshot_id=?,build_id=?,release_id=?,activation_receipt_id=?,activated_at=?,updated_at=? WHERE id=1 AND delivered_sequence=?",
        )
        .bind(
          value.sourceSequence,
          value.snapshotId,
          value.buildId,
          value.releaseId,
          value.activationReceiptId,
          value.activatedAt,
          now,
          value.expectedDeliveredSequence,
        ),
      db
        .prepare(
          "UPDATE site_publication_requests SET status='delivered',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,last_error_at=NULL,next_attempt_at=NULL,updated_at=? WHERE sequence<=?",
        )
        .bind(now, value.sourceSequence),
      prepareAuditLog(
        db,
        actor.identityType,
        actor.id,
        "site.publication.activation.recorded",
        "site_publication_request",
        value.requestId,
        {
          sourceSequence: value.sourceSequence,
          snapshotId: value.snapshotId,
          buildId: value.buildId,
          releaseId: value.releaseId,
          activationReceiptId: value.activationReceiptId,
        },
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "PUBLICATION_ACTIVATION_CHANGED",
        "Delivery changed or the activation receipt does not match the built release",
      );
    throw error;
  }
  return getSitePublicationDelivery(db);
}

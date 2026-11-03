import {
  badgeLabelBatchResponseSchema,
  type BadgeLabelBatchRequest,
} from "../../../../assets/shared/schemas/event-badge-label-batches";
import { generateBadgeCredential } from "../../../../assets/shared/schemas/badge-credential";
import { all } from "../../db/queries";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareOneTimeAuditLog, prepareScopedAuditLog, serializeAuditDetails } from "../audit";
import { auditActorIdentityId } from "../audit-actor";
import { personNameSql } from "../people/person-name-sql";
import { registrationBadgeDisplayRoleSql } from "../registrations/badge-role";
import { resolveBadgeExpiry } from "./badge-expiry";
import { badgeAttendeeEligibilitySql } from "./badge-attendees";
import { hashBadgeCredential } from "./badge-hash";
import { activeReprintableBadgeWhereSql } from "./badge-lifecycle";
import { badgePrintMetadataColumns, badgePrintMetadataFrom, canDisplayBadgeContact } from "./badge-print-metadata";
import { recoverBadgeCredential, sealBadgeCredential, type BadgePrintEnvironment } from "./badge-print-protection";

interface Selection {
  registrationId: string;
  userId: string;
  badgeId: string | null;
}
interface Receipt {
  actor_id: string;
  requestDigest: string;
  mappings: string;
}
interface LabelRow {
  id: string;
  registrationId: string;
  userId: string;
  selectedIdentityId: string | null;
  credentialHash: string;
  envelope: string;
  createdAt: string;
  expiresAt: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  jobTitle: string | null;
  badgeRole: string;
}
const currentTime = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const latestBadge = `(SELECT b.id FROM event_badge_credentials b WHERE ${activeReprintableBadgeWhereSql("b", "r.event_id", "r.user_id", currentTime)} ORDER BY b.created_at DESC,b.id DESC LIMIT 1)`;
// A single JSON parameter handles 1000 selections without a 1000-placeholder IN clause.
const selectionSql = `SELECT r.id AS registrationId,r.user_id AS userId,${latestBadge} AS badgeId
  FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.event_id=? AND ${badgeAttendeeEligibilitySql("r", "u")}
  AND r.id IN (SELECT value FROM json_each(?))`;
const projection = `SELECT ${badgePrintMetadataColumns},credential.id,
  credential.credential_hash AS credentialHash,credential.print_credential_json AS envelope,
  credential.created_at AS createdAt,credential.expires_at AS expiresAt,
  CASE WHEN ${canDisplayBadgeContact} THEN ${personNameSql("u")} ELSE NULL END AS displayName,
  ${registrationBadgeDisplayRoleSql("r")} AS badgeRole
  ${badgePrintMetadataFrom} WHERE credential.event_id=? AND ${badgeAttendeeEligibilitySql("r", "u")}
  AND credential.revoked_at IS NULL AND credential.expires_at>${currentTime}
  AND credential.print_credential_json IS NOT NULL
  AND credential.id IN (SELECT json_extract(value,'$.badgeId') FROM json_each(?))`;
const rowKeys: (keyof LabelRow)[] = [
  "id",
  "registrationId",
  "userId",
  "selectedIdentityId",
  "credentialHash",
  "envelope",
  "createdAt",
  "expiresAt",
  "displayName",
  "firstName",
  "lastName",
  "organization",
  "jobTitle",
  "badgeRole",
];
/** Bound strings stay well below D1's 2 MB value limit, including multibyte profile text. */
function guardGroups(rows: LabelRow[]): LabelRow[][] {
  const groups: LabelRow[][] = [];
  const encoder = new TextEncoder();
  let group: LabelRow[] = [],
    bytes = 2;
  for (const row of rows) {
    const size = encoder.encode(JSON.stringify(row)).byteLength + 1;
    if (size > 500_000)
      throw new AppError(413, "BADGE_PROFILE_TOO_LARGE", "An attendee profile is too large for printing.");
    if (group.length && (bytes + size > 500_000 || group.length === 100)) {
      groups.push(group);
      group = [];
      bytes = 2;
    }
    group.push(row);
    bytes += size;
  }
  if (group.length) groups.push(group);
  return groups;
}
function changed(): never {
  throw new AppError(
    409,
    "BADGE_BATCH_CHANGED",
    "The selected registrations or badges changed. Reload the print document.",
  );
}
function captureGuard(db: DatabaseLike, eventId: string) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM events WHERE id=? AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_state WHERE event_id=? AND (active_run_id IS NOT NULL OR capture_closed_at IS NOT NULL))`,
    bindings: [eventId, eventId],
  });
}

/** Set-based issuance and recovery: fixed-size SQL batches, never a per-attendee query/render loop. */
export async function prepareBadgeLabelBatch(
  db: DatabaseLike,
  environment: BadgePrintEnvironment,
  eventId: string,
  actorId: string,
  input: BadgeLabelBatchRequest,
) {
  const ids = JSON.stringify(input.registrationIds);
  const requestDigest = await hashBadgeCredential(JSON.stringify([...input.registrationIds].sort()));
  const receiptKey = `badge-label-batch:${eventId}:${input.operationId}`;
  const scope = { type: "event", id: eventId };
  let mappings: Selection[] | undefined;
  for (let attempt = 0; attempt < 3 && !mappings; attempt++) {
    const [receiptResult, eventResult, selectionResult] = await db.batch([
      db
        .prepare(`SELECT actor_id,json_extract(details_json,'$.requestDigest.to') AS requestDigest,
        json_extract(details_json,'$.mappings.to') AS mappings FROM audit_log
        WHERE idempotency_key=? AND scope_type='event' AND scope_id=? AND action='badge_label_batch_prepared'`)
        .bind(receiptKey, eventId),
      db.prepare("SELECT ends_at FROM events WHERE id=?").bind(eventId),
      db.prepare(selectionSql).bind(eventId, ids),
    ]);
    const receipt = receiptResult?.results?.[0] as unknown as Receipt | undefined;
    const selected = (selectionResult?.results ?? []) as unknown as Selection[];
    if (selected.length !== input.registrationIds.length) changed();
    if (receipt) {
      if (receipt.actor_id !== actorId || receipt.requestDigest !== requestDigest)
        throw new AppError(409, "BADGE_OPERATION_REUSED", "Use a new operation ID for a different badge action.");
      mappings = JSON.parse(receipt.mappings) as Selection[];
      if (
        mappings.length !== selected.length ||
        mappings.some(
          (item) => !selected.some((row) => row.registrationId === item.registrationId && row.userId === item.userId),
        )
      )
        changed();
      break;
    }
    const event = eventResult?.results?.[0] as { ends_at: string | null } | undefined;
    if (!event) changed();
    const now = nowIso();
    const missing = selected.filter((row) => !row.badgeId);
    const expiresAt = missing.length ? resolveBadgeExpiry(now, event.ends_at) : null;
    const additions = await Promise.all(
      missing.map(async (row) => {
        const id = crypto.randomUUID();
        const credential = generateBadgeCredential();
        const credentialHash = await hashBadgeCredential(credential);
        const envelope = await sealBadgeCredential(
          environment,
          { eventId, id, userId: row.userId, credentialHash },
          credential,
        );
        return {
          id,
          userId: row.userId,
          credentialHash,
          envelope,
          auditId: crypto.randomUUID(),
          auditDetails: serializeAuditDetails({ userId: row.userId, replacedBadgeId: null, expiresAt }),
        };
      }),
    );
    const planned = selected.map((row) => ({
      ...row,
      badgeId: row.badgeId ?? additions.find((item) => item.userId === row.userId)!.id,
    }));
    try {
      await db.batch([
        captureGuard(db, eventId),
        prepareAuthorizationGuard(db, {
          sql: `SELECT 1 WHERE EXISTS(SELECT 1 FROM events WHERE id=? AND ends_at IS ?) AND NOT EXISTS(
            SELECT 1 FROM json_each(?) expected LEFT JOIN registrations r
            ON r.id=json_extract(expected.value,'$.registrationId') AND r.event_id=?
            LEFT JOIN users u ON u.id=r.user_id
            WHERE r.id IS NULL OR NOT (${badgeAttendeeEligibilitySql("r", "u")}) OR u.id IS NULL OR r.user_id!=json_extract(expected.value,'$.userId')
            OR ${latestBadge} IS NOT json_extract(expected.value,'$.badgeId'))`,
          bindings: [eventId, event.ends_at, JSON.stringify(selected), eventId],
        }),
        prepareOneTimeAuditLog(
          db,
          "user",
          actorId,
          "badge_label_batch_prepared",
          "event",
          eventId,
          { requestDigest, mappings: planned },
          now,
          receiptKey,
          scope,
        ),
        db
          .prepare(`INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at,expires_at,print_credential_json)
          SELECT json_extract(value,'$.id'),?,json_extract(value,'$.userId'),json_extract(value,'$.credentialHash'),?,?,json_extract(value,'$.envelope') FROM json_each(?)`)
          .bind(eventId, now, expiresAt, JSON.stringify(additions)),
        db
          .prepare(`INSERT INTO audit_log(id,actor_type,actor_id,actor_identity_id,action,entity_type,entity_id,details_json,created_at,scope_type,scope_id)
          SELECT json_extract(value,'$.auditId'),'user',?,?,'badge_issued','event_badge_credential',json_extract(value,'$.id'),json_extract(value,'$.auditDetails'),?,'event',? FROM json_each(?)`)
          .bind(actorId, auditActorIdentityId("user", actorId), now, eventId, JSON.stringify(additions)),
      ]);
      mappings = planned;
    } catch (error) {
      // A concurrent issuance or a lost-response retry reuses the committed mapping on the next read.
      if (
        isAuthorizationGuardFailure(error) ||
        (error instanceof Error && error.message.includes("audit_log.idempotency_key"))
      )
        continue;
      throw error;
    }
  }
  if (!mappings) changed();
  const mappingJson = JSON.stringify(mappings);
  const rows = await all<LabelRow>(db, projection, [eventId, mappingJson]);
  if (
    rows.length !== mappings.length ||
    mappings.some(
      (item) =>
        !rows.some(
          (row) => row.id === item.badgeId && row.registrationId === item.registrationId && row.userId === item.userId,
        ),
    )
  )
    changed();
  const labels = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      registrationId: row.registrationId,
      userId: row.userId,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
      organization: row.organization,
      jobTitle: row.jobTitle,
      badgeRole: row.badgeRole,
      expiresAt: row.expiresAt,
      credential: await recoverBadgeCredential(
        environment,
        { eventId, id: row.id, userId: row.userId, credentialHash: row.credentialHash },
        row.envelope,
      ),
    })),
  );
  try {
    await db.batch([
      captureGuard(db, eventId),
      ...guardGroups(rows).map((group) =>
        prepareAuthorizationGuard(db, {
          sql: `SELECT 1 WHERE (SELECT COUNT(*) FROM (${projection}))=? AND NOT EXISTS(
          SELECT 1 FROM json_each(?) captured WHERE NOT EXISTS(SELECT 1 FROM (${projection}) live
          WHERE ${rowKeys.map((key) => `live.${key} IS json_extract(captured.value,'$.${key}')`).join(" AND ")}))`,
          bindings: [
            eventId,
            JSON.stringify(group.map((row) => ({ badgeId: row.id }))),
            group.length,
            JSON.stringify(group),
            eventId,
            JSON.stringify(group.map((row) => ({ badgeId: row.id }))),
          ],
        }),
      ),
      prepareScopedAuditLog(
        db,
        scope,
        "user",
        actorId,
        "badge_label_batch_recovered",
        "event",
        eventId,
        { count: labels.length, operationId: input.operationId },
        nowIso(),
        `${receiptKey}:print`,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) changed();
    throw error;
  }
  const byRegistration = new Map(labels.map((row) => [row.registrationId, row]));
  return badgeLabelBatchResponseSchema.parse({
    operationId: input.operationId,
    labels: input.registrationIds.map((id) => byRegistration.get(id)),
  });
}

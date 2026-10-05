import type { z } from "zod";
import type { DatabaseLike } from "../../types";
import { all, first } from "../../db/queries";
import { type AuthorizationEvidence } from "../../db/authorization-guard";
import { prepareScopedAuditLog } from "../audit";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { getAgenda, getAgendaOccurrence } from "./read";
import { commitAgendaRevision } from "./revision";
import {
  appearanceOverrideRequestSchema,
  appearanceOverrideReviewSchema,
  appearanceOverridesQuerySchema,
  appearanceOverrideSchema,
} from "../../../../assets/shared/schemas/event-appearance-overrides";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { sessionHistoryMetadataSchema } from "../../../../assets/shared/schemas/event-session-history";
type Row = {
  id: string;
  occurrence_id: string;
  appearance_json: string;
  reason: string;
  evidence: string;
  requested_by: string;
  requested_at: string;
  decision: "approved" | "rejected" | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  base_appearance_json: string | null;
};
const columns =
  "request.id,request.occurrence_id,request.appearance_json,request.base_appearance_json,request.reason,request.evidence,request.requested_by,request.requested_at,decision.decision,decision.reviewed_by,decision.reviewed_at,decision.reason AS review_reason";
const source =
  "FROM event_agenda_appearance_override_requests request LEFT JOIN event_agenda_appearance_override_decisions decision ON decision.request_id=request.id";
const decode = (r: Row) =>
  appearanceOverrideSchema.parse({
    id: r.id,
    occurrenceId: r.occurrence_id,
    appearance: JSON.parse(r.appearance_json),
    reason: r.reason,
    evidence: r.evidence,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    decision: r.decision,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    reviewReason: r.review_reason,
  });
export async function listAppearanceOverrides(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  query: z.infer<typeof appearanceOverridesQuerySchema>,
) {
  const where =
      "WHERE request.event_id=? AND request.occurrence_id=? AND INSTR(LOWER(request.reason||' '||request.evidence),LOWER(?))>0",
    bindings = [eventId, occurrenceId, query.q ?? ""];
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${source} ${where}`, bindings);
  const rows = await all<Row>(
    db,
    `SELECT ${columns} ${source} ${where} ORDER BY request.requested_at ${query.sort?.startsWith("-") ? "DESC" : "ASC"},request.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return {
    overrides: rows.map(decode),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, rows.length),
  };
}
function identityEvidence(
  eventId: string,
  occurrenceId: string,
  appearance: z.infer<typeof appearanceOverrideRequestSchema>["appearance"],
) {
  return {
    sql: "SELECT 1 FROM event_agenda_occurrences occurrence JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id AND speaker.user_id=? WHERE occurrence.id=? AND occurrence.event_id=? AND (? IS NULL OR EXISTS(SELECT 1 FROM identities identity WHERE identity.id=? AND identity.user_id=speaker.user_id AND identity.started_at IS NOT NULL AND identity.started_at<=COALESCE(occurrence.start_at,?) AND (identity.ended_at IS NULL OR identity.ended_at>COALESCE(occurrence.start_at,?)) AND (identity.blocked_at IS NULL OR identity.blocked_at>COALESCE(occurrence.start_at,?))))",
    bindings: [
      appearance.userId,
      occurrenceId,
      eventId,
      appearance.actingIdentityId,
      appearance.actingIdentityId,
      nowIso(),
      nowIso(),
      nowIso(),
    ],
  };
}
function domainGuard(db: DatabaseLike, evidence: AuthorizationEvidence) {
  return db
    .prepare(
      `INSERT INTO event_agenda_appearance_override_guards(id,valid) SELECT ?,CASE WHEN EXISTS(${evidence.sql}) THEN 1 ELSE 0 END`,
    )
    .bind(crypto.randomUUID(), ...evidence.bindings);
}
function domainCleanup(db: DatabaseLike) {
  return db.prepare("DELETE FROM event_agenda_appearance_override_guards WHERE valid=1");
}
function domainFailure(error: unknown): never {
  if (error instanceof Error && error.message.includes("appearance_override_evidence_valid"))
    throw new AppError(
      409,
      "APPEARANCE_OVERRIDE_EVIDENCE_CHANGED",
      "The person, dated identity or representation changed. Prepare a fresh request or review.",
    );
  throw error;
}
async function assertAppearanceIdentity(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  appearance: z.infer<typeof appearanceOverrideRequestSchema>["appearance"],
) {
  const evidence = identityEvidence(eventId, occurrenceId, appearance);
  if (!(await first<{ valid: number }>(db, evidence.sql, evidence.bindings)))
    throw new AppError(
      400,
      "APPEARANCE_OVERRIDE_IDENTITY_INVALID",
      "Choose an assigned canonical person and an identity valid at the session date.",
    );
}
export async function requestAppearanceOverride(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  input: z.infer<typeof appearanceOverrideRequestSchema>,
  actorId: string,
) {
  const session = await getAgendaOccurrence(db, eventId, occurrenceId),
    id = crypto.randomUUID(),
    clock = nowIso(),
    base = session.history?.appearances.find((a) => a.userId === input.appearance.userId) ?? null;
  await assertAppearanceIdentity(db, eventId, occurrenceId, input.appearance);
  try {
    await db.batch([
      domainGuard(db, {
        sql: "SELECT 1 FROM event_agenda_state WHERE event_id=? AND revision=?",
        bindings: [eventId, input.expectedRevision],
      }),
      domainGuard(db, identityEvidence(eventId, occurrenceId, input.appearance)),
      db
        .prepare(
          "INSERT INTO event_agenda_appearance_override_requests(id,event_id,occurrence_id,user_id,appearance_json,base_appearance_json,reason,evidence,requested_by,requested_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          occurrenceId,
          input.appearance.userId,
          JSON.stringify(input.appearance),
          JSON.stringify(base),
          input.reason,
          input.evidence,
          actorId,
          clock,
        ),
      prepareScopedAuditLog(
        db,
        { type: "event", id: eventId },
        "user",
        actorId,
        "agenda.appearance_override.request",
        "appearance_override",
        id,
        { requestId: id, occurrenceId, userId: input.appearance.userId },
      ),
      domainCleanup(db),
    ]);
  } catch (error) {
    domainFailure(error);
  }
  return decode((await first<Row>(db, `SELECT ${columns} ${source} WHERE request.id=?`, [id]))!);
}
export async function reviewAppearanceOverride(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  occurrenceId: string,
  requestId: string,
  input: z.infer<typeof appearanceOverrideReviewSchema>,
  actorId: string,
) {
  const row = await first<Row>(
    db,
    `SELECT ${columns} ${source} WHERE request.id=? AND request.event_id=? AND request.occurrence_id=?`,
    [requestId, eventId, occurrenceId],
  );
  if (!row) throw new AppError(404, "APPEARANCE_OVERRIDE_NOT_FOUND", "The appearance override is unavailable.");
  if (row.requested_by === actorId)
    throw new AppError(
      403,
      "APPEARANCE_OVERRIDE_SELF_REVIEW",
      "A different authorized reviewer must decide this request.",
    );
  if (row.decision)
    throw new AppError(409, "APPEARANCE_OVERRIDE_ALREADY_REVIEWED", "This override already has an immutable decision.");
  const session = await getAgendaOccurrence(db, eventId, occurrenceId),
    appearance = decode(row).appearance,
    current = session.history?.appearances.find((a) => a.userId === appearance.userId) ?? null;
  if (input.decision === "approved" && JSON.stringify(current) !== row.base_appearance_json)
    throw new AppError(
      409,
      "APPEARANCE_OVERRIDE_STALE",
      "The representation changed after this request. Submit a fresh request.",
    );
  await assertAppearanceIdentity(db, eventId, occurrenceId, appearance);
  const clock = nowIso(),
    statements = [
      domainGuard(db, identityEvidence(eventId, occurrenceId, appearance)),
      db
        .prepare(
          "INSERT INTO event_agenda_appearance_override_decisions(request_id,decision,reason,reviewed_by,reviewed_at,revision) VALUES(?,?,?,?,?,?)",
        )
        .bind(requestId, input.decision, input.reason, actorId, clock, input.expectedRevision + 1),
    ];
  if (input.decision === "approved") {
    statements.push(
      domainGuard(db, {
        sql: "SELECT 1 WHERE COALESCE((SELECT person.value FROM event_agenda_session_history history,json_each(history.metadata_json,'$.appearances') person WHERE history.occurrence_id=? AND json_extract(person.value,'$.userId')=?),'null')=?",
        bindings: [occurrenceId, appearance.userId, row.base_appearance_json],
      }),
    );
    const metadata = sessionHistoryMetadataSchema.parse(session.history ?? {});
    metadata.appearances = [
      ...metadata.appearances.filter((a) => a.userId !== appearance.userId),
      { ...appearance, approvedAt: clock },
    ];
    statements.push(
      db
        .prepare(
          "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(occurrence_id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
        )
        .bind(occurrenceId, JSON.stringify(metadata), actorId, clock),
    );
  }
  try {
    await commitAgendaRevision(
      db,
      eventId,
      input.expectedRevision,
      [
        ...statements,
        domainCleanup(db),
        prepareScopedAuditLog(
          db,
          { type: "event", id: eventId },
          "user",
          actorId,
          "agenda.appearance_override.review",
          "appearance_override",
          requestId,
          { requestId, decision: input.decision, reason: input.reason },
        ),
      ],
      actorId,
    );
  } catch (error) {
    domainFailure(error);
  }
  return {
    override: decode((await first<Row>(db, `SELECT ${columns} ${source} WHERE request.id=?`, [requestId]))!),
    agenda: await getAgenda(db, eventId, eventSlug),
  };
}

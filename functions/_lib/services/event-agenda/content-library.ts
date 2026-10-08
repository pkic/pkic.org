import { prepareHistoricalMappingReview } from "./historical-mapping-review";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { z } from "zod";
import {
  agendaContentFieldsSchema,
  agendaContentSchema,
  agendaContentQuerySchema,
  agendaContentsResponseSchema,
} from "../../../../assets/shared/schemas/event-agenda-content";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type { DatabaseLike } from "../../types";
import { all, first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { commitAgendaRevision, agendaSpeakerStatements } from "./mutations";
import { getAgenda } from "./read";
import { sessionHistoryMetadataSchema } from "../../../../assets/shared/schemas/event-session-history";
import { occurrenceRepresentationReferences, prepareRepresentationEligibility } from "./representation-eligibility";
type Content = z.infer<typeof agendaContentFieldsSchema>;
type Row = {
  id: string;
  event_id: string;
  title: string;
  description: string;
  kind: string;
  track: string | null;
  speaker_user_ids_json: string;
  speaker_roles_json: string;
  source_key: string | null;
  source_review_json: string | null;
  occurrence_count: number;
};
export async function getAgendaContent(db: DatabaseLike, eventId: string, id: string) {
  const row = await first<Row>(
    db,
    "SELECT content.id,content.event_id,content.title,content.description,content.kind,content.track,content.speaker_user_ids_json,content.speaker_roles_json,content.source_key,content.source_review_json,(SELECT COUNT(*) FROM event_agenda_occurrences occurrence WHERE occurrence.content_id=content.id) AS occurrence_count FROM event_agenda_contents content WHERE content.id=? AND content.event_id=?",
    [id, eventId],
  );
  if (!row) throw new AppError(404, "AGENDA_CONTENT_NOT_FOUND", "Session content not found.");
  return agendaContentSchema.parse({
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    track: row.track,
    speakerUserIds: JSON.parse(row.speaker_user_ids_json),
    speakerRoles: JSON.parse(row.speaker_roles_json ?? "{}"),
    sourceKey: row.source_key,
    review: row.source_review_json ? JSON.parse(row.source_review_json) : null,
    occurrenceCount: row.occurrence_count,
  });
}
export async function listAgendaContents(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = agendaContentQuerySchema.parse(raw);
  const values = [eventId, query.q ?? ""];
  const where = "event_id=? AND INSTR(LOWER(title),LOWER(?))>0";
  const count = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM event_agenda_contents WHERE ${where}`,
    values,
  );
  const rows = await all<Row>(
    db,
    `SELECT content.id,content.event_id,content.title,content.description,content.kind,content.track,content.speaker_user_ids_json,content.speaker_roles_json,content.source_key,content.source_review_json,(SELECT COUNT(*) FROM event_agenda_occurrences occurrence WHERE occurrence.content_id=content.id) AS occurrence_count FROM event_agenda_contents content WHERE ${where} ORDER BY title ${query.sort === "-title" ? "DESC" : "ASC"},id LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  return agendaContentsResponseSchema.parse({
    contents: rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      title: row.title,
      description: row.description,
      kind: row.kind,
      track: row.track,
      speakerUserIds: JSON.parse(row.speaker_user_ids_json),
      speakerRoles: JSON.parse(row.speaker_roles_json ?? "{}"),
      sourceKey: row.source_key,
      review: row.source_review_json ? JSON.parse(row.source_review_json) : null,
      occurrenceCount: row.occurrence_count,
    })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, rows.length),
  });
}
export function prepareCreateAgendaContent(
  db: DatabaseLike,
  eventId: string,
  id: string,
  raw: unknown,
  sourceKey: string | null = null,
) {
  const content = agendaContentFieldsSchema.parse(raw);
  const now = nowIso();
  return db
    .prepare(
      "INSERT INTO event_agenda_contents(id,event_id,title,description,kind,track,speaker_user_ids_json,speaker_roles_json,source_key,source_snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      eventId,
      content.title,
      content.description,
      content.kind,
      content.track ?? null,
      JSON.stringify(content.speakerUserIds),
      JSON.stringify(content.speakerRoles),
      sourceKey,
      sourceKey ? JSON.stringify(content) : null,
      now,
      now,
    );
}
async function checkContentPeople(db: DatabaseLike, content: Content) {
  if (Object.keys(content.speakerRoles).some((userId) => !content.speakerUserIds.includes(userId)))
    throw new AppError(400, "CONTENT_ROLE_PERSON_MISMATCH", "Assign credit roles only to the selected people.");
  const ids = JSON.stringify(content.speakerUserIds);
  const row = await first<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM users WHERE id IN(SELECT value FROM json_each(?))",
    [ids],
  );
  if (row?.count !== content.speakerUserIds.length)
    throw new AppError(400, "CONTENT_PERSON_UNKNOWN", "Resolve each speaker to a canonical person before saving.");
  return prepareAuthorizationGuard(db, {
    sql: "SELECT 1 WHERE (SELECT COUNT(*) FROM users WHERE id IN(SELECT value FROM json_each(?)))=?",
    bindings: [ids, content.speakerUserIds.length],
  });
}
export async function createAgendaContent(
  db: DatabaseLike,
  eventId: string,
  revision: number,
  raw: unknown,
  actorId: string,
) {
  const content = agendaContentFieldsSchema.parse(raw),
    id = crypto.randomUUID();
  await commitAgendaRevision(
    db,
    eventId,
    revision,
    [await checkContentPeople(db, content), prepareCreateAgendaContent(db, eventId, id, content)],
    actorId,
  );
  return getAgendaContent(db, eventId, id);
}
export async function updateAgendaContent(
  db: DatabaseLike,
  eventId: string,
  id: string,
  revision: number,
  raw: unknown,
  resolveReview: boolean,
  actorId: string,
) {
  const existingContent = await getAgendaContent(db, eventId, id);
  const parsed = agendaContentFieldsSchema.parse(raw);
  const content = { ...parsed, track: parsed.track === undefined ? existingContent.track : parsed.track };
  const placements = await all<{ id: string }>(
    db,
    "SELECT id FROM event_agenda_occurrences WHERE event_id=? AND content_id=? LIMIT 101",
    [eventId, id],
  );
  if (placements.length > 100)
    throw new AppError(422, "CONTENT_PLACEMENT_LIMIT", "Update repeated sessions in batches of at most 100.");
  const representationStatements = [];
  if (resolveReview && existingContent.review?.incomingHistoricalMetadata)
    representationStatements.push(
      ...(await prepareHistoricalMappingReview(db, eventId, id, existingContent.review, content, actorId)),
    );
  const incomingRepresentations = resolveReview ? existingContent.review?.incomingProposalRepresentations : undefined;
  if (incomingRepresentations) {
    const event = await first<{ slug: string }>(db, "SELECT slug FROM events WHERE id=?", [eventId]);
    if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
    const agenda = await getAgenda(db, eventId, event.slug);
    const affected = agenda.occurrences
      .filter((item) => placements.some((placement) => placement.id === item.id))
      .map((item) => ({
        ...item,
        history: sessionHistoryMetadataSchema.parse({
          ...item.history,
          proposalRepresentations: incomingRepresentations,
        }),
      }));
    representationStatements.push(
      ...(await prepareRepresentationEligibility(db, occurrenceRepresentationReferences(affected))),
    );
    representationStatements.push(
      ...affected.map((item) =>
        db
          .prepare(
            "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(occurrence_id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
          )
          .bind(item.id, JSON.stringify(item.history), actorId, nowIso()),
      ),
    );
  }
  await commitAgendaRevision(
    db,
    eventId,
    revision,
    [
      await checkContentPeople(db, content),
      ...representationStatements,
      db
        .prepare(
          "UPDATE event_agenda_contents SET title=?,description=?,kind=?,track=?,speaker_user_ids_json=?,speaker_roles_json=?,source_snapshot_json=CASE WHEN ?=1 AND json_extract(source_review_json,'$.incoming') IS NOT NULL THEN json_set(CASE WHEN json_extract(source_review_json,'$.incomingHistoricalMetadata') IS NOT NULL THEN json_set(json_extract(source_review_json,'$.incoming'),'$.historicalMetadataEvidence',json(json_extract(source_review_json,'$.incomingHistoricalMetadata')),'$.originalHistoricalMetadataEvidence',json(COALESCE(json_extract(source_snapshot_json,'$.originalHistoricalMetadataEvidence'),json_extract(source_review_json,'$.incomingHistoricalMetadata')))) ELSE json_extract(source_review_json,'$.incoming') END,'$.retainedSourceEvidence',json(COALESCE(json_extract(source_snapshot_json,'$.retainedSourceEvidence'),'[]'))) ELSE source_snapshot_json END,source_review_json=CASE WHEN ?=1 AND json_extract(source_review_json,'$.incoming') IS NOT NULL THEN NULL ELSE source_review_json END,updated_at=? WHERE event_id=? AND id=?",
        )
        .bind(
          content.title,
          content.description,
          content.kind,
          content.track ?? null,
          JSON.stringify(content.speakerUserIds),
          JSON.stringify(content.speakerRoles),
          resolveReview ? 1 : 0,
          resolveReview ? 1 : 0,
          nowIso(),
          eventId,
          id,
        ),
      db
        .prepare(
          "UPDATE event_agenda_occurrences SET title=?,description=?,kind=?,track=? WHERE event_id=? AND content_id=?",
        )
        .bind(content.title, content.description, content.kind, content.track ?? null, eventId, id),
      ...placements.flatMap((item) => contentSpeakerStatements(db, item.id, content)),
    ],
    actorId,
  );
  return getAgendaContent(db, eventId, id);
}
/** New copies contain substantive content and canonical people only; no allocation or appearance confirmation is copied. */
export async function copyAgendaContent(
  db: DatabaseLike,
  sourceEventId: string,
  sourceId: string,
  targetEventId: string,
  revision: number,
  actorId: string,
) {
  const source = await getAgendaContent(db, sourceEventId, sourceId);
  return createAgendaContent(db, targetEventId, revision, source, actorId);
}
export async function placeAgendaContent(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  id: string,
  revision: number,
  copyAsNew: boolean,
  actorId: string,
) {
  const source = await getAgendaContent(db, eventId, id),
    occurrenceId = crypto.randomUUID(),
    contentId = copyAsNew ? crypto.randomUUID() : id;
  const statements = copyAsNew ? [prepareCreateAgendaContent(db, eventId, contentId, source)] : [];
  statements.push(...prepareAgendaContentPlacement(db, eventId, occurrenceId, contentId, source));
  await commitAgendaRevision(db, eventId, revision, statements, actorId);
  return { agenda: await getAgenda(db, eventId, eventSlug), occurrenceId, contentId };
}

/** Placement starts private and unscheduled; admissions, source identity and historical approvals stay with the original. */
export function prepareAgendaContentPlacement(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  contentId: string,
  content: Content,
) {
  return [
    db
      .prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,content_id,title,description,kind,track,start_at,end_at,room_id,admission_policy,capacity,remote_capacity,visibility) VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,'preference',NULL,NULL,'private')",
      )
      .bind(occurrenceId, eventId, contentId, content.title, content.description, content.kind, content.track ?? null),
    ...contentSpeakerStatements(db, occurrenceId, content),
  ];
}

export function contentSpeakerStatements(db: DatabaseLike, occurrenceId: string, content: Content) {
  return agendaSpeakerStatements(db, occurrenceId, content.speakerUserIds, content.speakerRoles);
}

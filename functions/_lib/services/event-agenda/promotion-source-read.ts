import type { DatabaseLike, D1StatementResult } from "../../types";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { preparePromotionDesign } from "./promotion-design";
import { preparePromotionComposition } from "./promotion-composition";
import {
  preparePromotionMetrics,
  preparePromotionRenderStatus,
  decodePromotionProgress,
} from "./promotion-render-status";
import { preparePromotionReferralCreation } from "./promotion-referral";
import { prepareAgendaSpeakers, decodeAgendaSpeakers, type AgendaSpeakerRow } from "./speaker-profiles";
import { storedAgendaSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-stored";
import { batchFirst, batchRows } from "../../db/pagination";
import { personDisplayNameSql } from "../people/person-name-sql";
import { REGISTRATION_ORGANIZATION_SQL, REGISTRATION_JOB_TITLE_SQL } from "../registrations/selected-identity";
import { AppError } from "../../errors";

/** A bounded, current source projection; no stored profile copy is used by the renderer. */
export function preparePromotionSourceRead(
  db: DatabaseLike,
  event: EventReadSelection,
  userId: string,
  occurrenceId: string | null,
  authorization?: { sql: string; bindings: readonly unknown[] },
  initialize = true,
) {
  const scope = eventReadIdSql(event),
    visual = preparePromotionDesign(db, event),
    personal = preparePromotionComposition(db, event, userId, occurrenceId),
    metrics = preparePromotionMetrics(db, event, userId, occurrenceId);
  const eligible = {
    sql: `SELECT 1 FROM events event JOIN users person ON person.id=? AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL WHERE event.id=${scope.sql} AND ${occurrenceId ? `EXISTS(SELECT 1 FROM event_agenda_publications publication JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision,json_each(publication.snapshot_json,'$.occurrences') entry WHERE publication.event_id=event.id AND json_extract(entry.value,'$.id')=? AND json_extract(entry.value,'$.visibility')='public' AND json_extract(entry.value,'$.kind')<>'break')` : "EXISTS(SELECT 1 FROM registrations WHERE event_id=event.id AND user_id=person.id AND status='registered')"}`,
    bindings: [userId, ...scope.bindings, ...(occurrenceId ? [occurrenceId] : [])],
  };
  const wanted = occurrenceId
    ? { sql: "json_extract(entry.value,'$.id')=?", bindings: [occurrenceId] }
    : {
        sql: `json_extract(entry.value,'$.id') IN(SELECT value FROM event_promotion_kits personal,json_each(personal.composition_json,'$.sessionIds') WHERE personal.event_id=p.event_id AND personal.user_id=? AND personal.occurrence_id IS NULL)`,
        bindings: [userId],
      };
  const statements = [
    ...visual.statements,
    ...personal.statements,
    db
      .prepare(
        `SELECT json_set(p.snapshot_json,'$.occurrences',json(COALESCE((SELECT json_group_array(json(entry.value)) FROM json_each(p.snapshot_json,'$.occurrences') entry WHERE json_extract(entry.value,'$.visibility')='public' AND json_extract(entry.value,'$.kind')<>'break' AND ${wanted.sql}),'[]')),'$.shifts',json('[]'),'$.roleMembers',json('[]'),'$.assignments',json('[]')) AS snapshot_json,p.revision FROM event_agenda_publications p JOIN event_agenda_state state ON state.event_id=p.event_id AND state.published_revision=p.revision WHERE p.event_id=${scope.sql}`,
      )
      .bind(...wanted.bindings, ...scope.bindings),
    db
      .prepare(
        `SELECT EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=${scope.sql} AND occurrence.id=? AND speaker.user_id=?) AS assigned,EXISTS(SELECT 1 FROM registrations WHERE event_id=${scope.sql} AND user_id=? AND status='registered') AS registered`,
      )
      .bind(...scope.bindings, occurrenceId, userId, ...scope.bindings, userId),
    occurrenceId
      ? prepareAgendaSpeakers(db, event, [occurrenceId], "credit")
      : db
          .prepare(
            `SELECT ${personDisplayNameSql("person", "Attendee")} AS display_name,${REGISTRATION_JOB_TITLE_SQL} AS job_title,${REGISTRATION_ORGANIZATION_SQL} AS organization_name,person.headshot_r2_key FROM registrations r JOIN users person ON person.id=r.user_id WHERE r.event_id=${scope.sql} AND person.id=? AND r.status='registered' AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
          )
          .bind(...scope.bindings, userId),
    db
      .prepare(
        `SELECT slug FROM session_page_slugs WHERE event_id=${scope.sql} AND occurrence_id=? AND retired_at IS NULL LIMIT 1`,
      )
      .bind(...scope.bindings, occurrenceId),
    initialize
      ? preparePromotionReferralCreation(
          db,
          event,
          userId,
          authorization
            ? {
                sql: `WITH eligible_source AS MATERIALIZED(${eligible.sql}), authorized_source AS MATERIALIZED(${authorization.sql}) SELECT 1 FROM eligible_source,authorized_source LIMIT 1`,
                bindings: [...eligible.bindings, ...authorization.bindings],
              }
            : eligible,
        )
      : db.prepare("SELECT 1"),
    ...metrics.statements,
    preparePromotionRenderStatus(db, event, userId, occurrenceId),
  ];
  return {
    statements,
    async decode(loaded: D1StatementResult[]) {
      const design = await visual.decode(loaded.slice(0, visual.statements.length));
      const personalOffset = visual.statements.length;
      const composition = await personal.decode(loaded.slice(personalOffset, personalOffset + 1), design.event.id);
      const offset = personalOffset + 1,
        publication = batchFirst<{ snapshot_json: string; revision: number }>(loaded[offset]);
      if (!publication && occurrenceId)
        throw new AppError(
          409,
          "AGENDA_NOT_PUBLISHED",
          "Approve this event agenda before generating promotion materials.",
        );
      const agenda = storedAgendaSnapshotSchema.parse(
        publication
          ? JSON.parse(publication.snapshot_json)
          : {
              eventSlug: design.event.slug,
              eventName: design.event.name,
              timeZone: design.event.timezone,
              revision: 0,
              publishedRevision: null,
              rooms: [],
              occurrences: [],
              shifts: [],
              roleMembers: [],
              assignments: [],
            },
      );
      const entitlement = batchFirst<{ assigned: number; registered: number }>(loaded[offset + 1]);
      const person = batchFirst<{
        display_name: string;
        job_title: string | null;
        organization_name: string | null;
        headshot_r2_key: string | null;
      }>(loaded[offset + 2]);
      const people = occurrenceId
        ? (decodeAgendaSpeakers(batchRows<AgendaSpeakerRow>(loaded[offset + 2])).get(occurrenceId) ?? [])
        : [];
      const slug = batchFirst<{ slug: string }>(loaded[offset + 3])?.slug;
      if (occurrenceId && slug) agenda.sessionSlugs = { [occurrenceId]: slug };
      const progress = metrics.decode(loaded.slice(offset + 5, offset + 6));
      return {
        publishedRevision: publication?.revision ?? null,
        visual: design,
        personal: composition,
        agenda,
        people,
        person,
        code: progress.code ?? "",
        metrics: progress.metrics,
        assigned: Boolean(entitlement?.assigned),
        registered: Boolean(entitlement?.registered),
        occurrenceId,
        artifacts: (fingerprint: string) => decodePromotionProgress(loaded.slice(offset + 6, offset + 7), fingerprint),
      };
    },
  };
}
export type PromotionSourceBasis = Awaited<ReturnType<ReturnType<typeof preparePromotionSourceRead>["decode"]>>;

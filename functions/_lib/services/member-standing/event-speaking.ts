import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { STANDING_REASON_POINTS } from "../../../../assets/shared/member-standing";
import { PROPOSAL_SPEAKER_ROLES } from "../../../../assets/shared/schemas/participant-roles";
import type { DatabaseLike, StatementLike } from "../../types";

/** Current agenda credits and all earlier automated awards share one source. */
function speakingAdjustments(at: string, eventId: EventReadSelection | null, revisionIncrement: number, limit: number) {
  const event = eventId === null ? { sql: "?", bindings: [null] } : eventReadIdSql(eventId);
  return {
    sql: `WITH controls(at,event_id,revision_increment,row_limit,points,roles) AS (VALUES (?,${event.sql},?,?,?,?)),
    source_keys AS (
      SELECT speaker.occurrence_id,speaker.user_id,event.ends_at AS awarded_at
      FROM event_agenda_occurrence_speakers speaker
      JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id
      JOIN events event ON event.id=occurrence.event_id
      JOIN standing_settings settings ON settings.id='default' JOIN controls
      WHERE event.ends_at>=settings.activity_started_at AND event.ends_at<=controls.at
        AND (controls.event_id IS NULL OR event.id=controls.event_id)
      UNION
      SELECT link.occurrence_id,award.user_id,award.awarded_at
      FROM standing_agenda_awards link JOIN user_standing_awards award ON award.id=link.award_id
      JOIN event_agenda_occurrences occurrence ON occurrence.id=link.occurrence_id JOIN controls
      WHERE controls.event_id IS NULL OR occurrence.event_id=controls.event_id
    ), balances AS (
      SELECT source.occurrence_id,source.user_id,source.awarded_at,
        state.revision+controls.revision_increment AS revision,event.updated_at AS event_updated_at,
        COALESCE((SELECT SUM(award.points) FROM standing_agenda_awards link
          JOIN user_standing_awards award ON award.id=link.award_id
          WHERE link.occurrence_id=source.occurrence_id AND award.user_id=source.user_id
            AND award.awarded_at=source.awarded_at),0) AS credited_points,
        CASE WHEN event.ends_at=source.awarded_at AND event.ends_at<=controls.at
          AND event.ends_at>=settings.activity_started_at
          AND occurrence.start_at IS NOT NULL AND occurrence.end_at<=event.ends_at
          AND occurrence.placeholder=0 AND occurrence.kind<>'break'
          AND EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker
            WHERE speaker.occurrence_id=source.occurrence_id AND speaker.user_id=source.user_id
              AND speaker.role IN(SELECT value FROM json_each(controls.roles)))
        THEN COALESCE((SELECT award.points FROM standing_agenda_awards link
          JOIN user_standing_awards award ON award.id=link.award_id
          WHERE link.occurrence_id=source.occurrence_id AND award.user_id=source.user_id
            AND award.reason_key='event_spoke' AND award.points>0
          ORDER BY award.created_at,award.id LIMIT 1),controls.points) ELSE 0 END AS expected_points
      FROM source_keys source
      JOIN event_agenda_occurrences occurrence ON occurrence.id=source.occurrence_id
      JOIN events event ON event.id=occurrence.event_id
      JOIN event_agenda_state state ON state.event_id=event.id
      JOIN users person ON person.id=source.user_id
      JOIN standing_settings settings ON settings.id='default' JOIN controls
      WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
    )
    SELECT occurrence_id,user_id,awarded_at,expected_points-credited_points AS points,
      CASE WHEN expected_points>credited_points THEN 'event_spoke' ELSE 'correction' END AS reason_key,
      occurrence_id||':'||revision||':'||event_updated_at||':'||awarded_at AS source_ref
    FROM balances WHERE expected_points<>credited_points
    ORDER BY awarded_at,occurrence_id,user_id LIMIT (SELECT row_limit FROM controls)`,
    bindings: [
      at,
      ...event.bindings,
      revisionIncrement,
      limit,
      STANDING_REASON_POINTS.event_spoke,
      JSON.stringify(PROPOSAL_SPEAKER_ROLES.filter((role) => role !== "proposer")),
    ],
  };
}

/**
 * Both statements run in the activity owner's batch. The link distinguishes
 * automated adjustments from staff corrections, which reconciliation must not undo.
 */
export function prepareEventSpeakingStanding(
  db: DatabaseLike,
  at: string,
  options: { eventId?: EventReadSelection; nextAgendaRevision?: boolean; limit?: number } = {},
): StatementLike[] {
  const source = speakingAdjustments(
    at,
    options.eventId ?? null,
    options.nextAgendaRevision ? 1 : 0,
    options.limit ?? (options.eventId ? 60000 : 50),
  );
  return [
    db
      .prepare(`INSERT INTO user_standing_awards
      (id,user_id,reason_key,points,source_type,source_ref,awarded_at,created_at)
      SELECT lower(hex(randomblob(16))),source.user_id,source.reason_key,source.points,
        'agenda_occurrence_revision',source.source_ref,source.awarded_at,?
      FROM (${source.sql}) source WHERE 1
      ON CONFLICT(user_id,reason_key,source_type,source_ref)
        WHERE source_type IS NOT NULL AND source_ref IS NOT NULL DO NOTHING`)
      .bind(at, ...source.bindings),
    db
      .prepare(`INSERT INTO standing_agenda_awards (award_id,occurrence_id)
      SELECT award.id,source.occurrence_id FROM (${source.sql}) source
      JOIN user_standing_awards award ON award.user_id=source.user_id AND award.reason_key=source.reason_key
        AND award.source_type='agenda_occurrence_revision' AND award.source_ref=source.source_ref
      WHERE 1 ON CONFLICT(award_id) DO NOTHING`)
      .bind(...source.bindings),
  ];
}

/** Events earn speaking credit when they end; old events are never backfilled. */
export async function reconcileEventSpeakingStanding(db: DatabaseLike, at: string, limit = 50): Promise<void> {
  await db.batch(prepareEventSpeakingStanding(db, at, { limit }));
}

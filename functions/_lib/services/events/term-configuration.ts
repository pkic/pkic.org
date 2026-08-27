import type { EventTermsReplaceInput } from "../../../../assets/shared/schemas/event-configuration";
import { all } from "../../db/queries";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareEventConfigurationRevision, type EventConfigurationMutationContext } from "./configuration-revision";

type EventTermsInput = EventTermsReplaceInput;
type AudienceType = keyof EventTermsInput;

export interface EventTermRow {
  id: string;
  audience_type: string;
  term_key: string;
  version: string;
  required: number;
  content_ref: string | null;
  display_text: string | null;
  help_text: string | null;
  active: number;
}

export interface EventTermsByAudience {
  attendee: EventTermRow[];
  speaker: EventTermRow[];
  presentation: EventTermRow[];
}

export async function listConfiguredEventTerms(db: DatabaseLike, eventId: string): Promise<EventTermsByAudience> {
  const rows = await all<EventTermRow>(
    db,
    `SELECT id, audience_type, term_key, version, required, content_ref, display_text, help_text, active
     FROM event_terms
     WHERE event_id = ? AND active = 1
     ORDER BY audience_type ASC, rowid ASC`,
    [eventId],
  );
  return {
    attendee: rows.filter((row) => row.audience_type === "attendee"),
    speaker: rows.filter((row) => row.audience_type === "speaker"),
    presentation: rows.filter((row) => row.audience_type === "presentation"),
  };
}

function termStatements(
  db: DatabaseLike,
  eventId: string,
  audienceType: AudienceType,
  terms: EventTermsInput[AudienceType],
  createdAt: string,
): StatementLike[] {
  return [
    db
      .prepare("UPDATE event_terms SET active = 0 WHERE event_id = ? AND audience_type = ?")
      .bind(eventId, audienceType),
    ...terms.map((term) =>
      db
        .prepare(
          `INSERT INTO event_terms (
             id, event_id, audience_type, term_key, version, required, content_ref,
             display_text, help_text, active, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(event_id, audience_type, term_key, version)
           DO UPDATE SET
             required = excluded.required,
             content_ref = excluded.content_ref,
             display_text = excluded.display_text,
             help_text = excluded.help_text,
             active = 1`,
        )
        .bind(
          uuid(),
          eventId,
          audienceType,
          term.termKey,
          term.version,
          term.required ? 1 : 0,
          term.contentRef ?? null,
          term.displayText,
          term.helpText ?? null,
          createdAt,
        ),
    ),
  ];
}

/** Atomically replaces all audience term sets and records the audit event. */
export async function replaceConfiguredEventTerms(
  db: DatabaseLike,
  eventId: string,
  input: EventTermsInput,
  context: EventConfigurationMutationContext,
): Promise<{ updatedAt: string }> {
  const now = nowIso();
  const revision = prepareEventConfigurationRevision(db, eventId, context, "event_terms_replaced", {
    attendeeCount: input.attendee.length,
    speakerCount: input.speaker.length,
    presentationCount: input.presentation.length,
  });
  await db.batch([
    ...(context.authorizationGuards ?? []),
    ...termStatements(db, eventId, "attendee", input.attendee, now),
    ...termStatements(db, eventId, "speaker", input.speaker, now),
    ...termStatements(db, eventId, "presentation", input.presentation, now),
    ...revision.statements,
  ]);
  return { updatedAt: revision.updatedAt };
}

import { eventProposalCallSchema, type EventProposalCall } from "../../../../assets/shared/schemas/event-management";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { resolveEventFrontendRoutes } from "../event-presentation";
import type { EventRecord } from "../event-types";
import { defaultFormAudience } from "../forms/placements";
import { formSubmissionWindowOpenSql } from "../forms/submission-window";

const CLOSED: EventProposalCall = { open: false, path: null, closesAt: null };

/**
 * Whether one event's call for proposals takes submissions now, from the
 * existing proposal-window data: an active proposal-submission form placed on
 * this event whose submission window is open, on an event that has not ended
 * and has a public page to submit through. An event that unlinks its proposal
 * form (`settings.forms.proposal_submission: null`) has no call.
 */
export async function readEventProposalCall(db: DatabaseLike, eventId: string): Promise<EventProposalCall> {
  const row = await first<{
    slug: string;
    base_path: string | null;
    starts_at: string | null;
    settings_json: string;
    source_mode: EventRecord["source_mode"];
    accepting: number;
    closes_at: string | null;
  }>(
    db,
    // The open placement that stays open longest decides when the call closes; one without an end never does.
    `SELECT event.slug, event.base_path, event.starts_at, event.settings_json, event.source_mode,
       (event.ends_at IS NULL OR event.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       AND open_call.id IS NOT NULL AS accepting,
       open_call.closes_at
     FROM events event
     LEFT JOIN form_placements open_call ON open_call.id = (
       SELECT fp.id FROM form_placements fp JOIN forms f ON f.id = fp.form_id
        WHERE fp.context_type = 'event' AND fp.context_ref = event.id AND fp.active = 1 AND fp.audience = ?
          AND f.status = 'active' AND f.purpose = 'proposal_submission' AND ${formSubmissionWindowOpenSql("fp")}
        ORDER BY fp.closes_at IS NULL DESC, fp.closes_at DESC
        LIMIT 1)
     WHERE event.id = ?`,
    [defaultFormAudience("proposal_submission"), eventId],
  );
  if (!row?.accepting || !row.base_path) return CLOSED;
  const forms = parseJsonSafe<{ forms?: Record<string, unknown> }>(row.settings_json, {}).forms;
  if (forms?.proposal_submission === null) return CLOSED;
  return eventProposalCallSchema.parse({
    open: true,
    path: resolveEventFrontendRoutes(row).proposalPath,
    closesAt: row.closes_at,
  });
}

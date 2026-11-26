import {
  sponsorLeadNoteResponseSchema,
  type sponsorLeadNoteRequestSchema,
} from "../../../../assets/shared/schemas/event-sponsor-lead-list";
import type { z } from "zod";
import { userSessionAuthorizationEvidence } from "../../auth/identity-capacities";
import { activeLeadSponsorOfEventSql } from "../../auth/sponsor-organization-lead-access";
import { guardAuthorizedDatabase } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { eventContactAccessSql } from "./evidence-retention";
import { sponsorLeadReadEvidence } from "./lead-scope";
import { sponsorConsentSql } from "./sponsor-consent";

const LEAD = "event_sponsor_leads";

/**
 * Replaces the sponsor team's one note about a lead. The lead's sponsor contact may edit any lead; an operator
 * may edit only a lead they captured. Live sponsorship, consent, contact retention and scope are rechecked in the
 * write itself, together with the signed-in session, and the audit row records the change without the note's text.
 */
export async function replaceSponsorLeadNote(
  sourceDb: DatabaseLike,
  eventId: string,
  sponsorId: string,
  leadId: string,
  actor: UserBackedAuthAdmin,
  input: z.infer<typeof sponsorLeadNoteRequestSchema>,
) {
  if (!actor.sessionId)
    throw new AppError(403, "HUMAN_SESSION_REQUIRED", "Sign in to the event app to write lead notes.");
  // A session revoked or expired after authentication refuses the whole batch, so no note lands without it.
  const db = guardAuthorizedDatabase(
    sourceDb,
    userSessionAuthorizationEvidence(actor.id, actor.sessionId),
    () => new AppError(401, "AUTH_EXPIRED", "Your session has ended. Sign in again to save the note."),
  );
  const all = sponsorLeadReadEvidence(actor, "agenda:leads_view", "sponsor.id");
  const mine = sponsorLeadReadEvidence(actor, "agenda:leads_capture", "sponsor.id");
  const note = input.note || null;
  const updatedAt = nowIso();
  try {
    const [update] = await db.batch([
      db
        .prepare(
          `UPDATE ${LEAD} SET note=?, note_updated_at=?
          WHERE id=? AND event_id=? AND sponsor_id=?
            AND EXISTS(SELECT 1 FROM sponsorships sponsor
              JOIN registrations reg ON reg.event_id=${LEAD}.event_id AND reg.user_id=${LEAD}.user_id
              JOIN users attendee ON attendee.id=${LEAD}.user_id
              WHERE sponsor.id=${LEAD}.sponsor_id AND ${activeLeadSponsorOfEventSql("sponsor", `${LEAD}.event_id`, "read")}
                AND reg.status='registered' AND attendee.active=1 AND ${sponsorConsentSql("reg")}
                AND ${eventContactAccessSql(`${LEAD}.event_id`)}
                AND ((${all.sql}) OR ((${mine.sql}) AND EXISTS(SELECT 1 FROM event_scan_attempts own
                  WHERE own.event_id=${LEAD}.event_id AND own.sponsor_id=${LEAD}.sponsor_id
                    AND own.user_id=${LEAD}.user_id AND own.operator_user_id=?
                    AND own.action='lead' AND own.outcome='eligible'))))
          RETURNING note, note_updated_at`,
        )
        .bind(note, updatedAt, leadId, eventId, sponsorId, ...all.bindings, ...mine.bindings, actor.id),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        actor.id,
        "sponsor_lead_note_replaced",
        "event_sponsor_lead",
        leadId,
        { hasNote: note !== null },
        updatedAt,
        { type: "event", id: eventId },
      ),
    ]);
    const saved = batchFirst<{ note: string | null; note_updated_at: string | null }>(update);
    if (!saved) throw notFound();
    return sponsorLeadNoteResponseSchema.parse({ note: saved.note, noteUpdatedAt: saved.note_updated_at });
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) throw notFound();
    if (error instanceof Error && error.message.includes("EVENT_EVIDENCE_CAPTURE_CLOSED"))
      throw new AppError(409, "LEAD_CHANGES_CLOSED", "Lead changes are closed for this event.");
    throw error;
  }
}

function notFound() {
  return new AppError(404, "LEAD_NOT_FOUND", "Current consenting lead not found.");
}

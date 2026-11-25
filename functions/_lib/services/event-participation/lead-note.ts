import {
  sponsorLeadNoteResponseSchema,
  type sponsorLeadNoteRequestSchema,
} from "../../../../assets/shared/schemas/event-sponsor-lead-list";
import type { z } from "zod";
import { activeLeadSponsorOfEventSql } from "../../auth/sponsor-organization-lead-access";
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
 * write itself, and the audit row records the change without the note's text.
 */
export async function replaceSponsorLeadNote(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  leadId: string,
  actor: UserBackedAuthAdmin,
  input: z.infer<typeof sponsorLeadNoteRequestSchema>,
) {
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
              WHERE sponsor.id=${LEAD}.sponsor_id AND ${activeLeadSponsorOfEventSql("sponsor", `${LEAD}.event_id`)}
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

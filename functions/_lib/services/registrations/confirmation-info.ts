import { REGISTRATION_ORGANIZATION_SQL } from "./selected-identity";
import { batchFirst } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL } from "./recipient-email";

export interface RegistrationConfirmationInfo {
  user_id: string;
  event_id: string;
  transition_revision: number;
  confirmation_link_secret: string | null;
  pending_confirmation_deadline_at: string | null;
  normalized_email: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  organization_name: string | null;
  event_name: string;
}

export async function getRegistrationConfirmationInfo(
  db: DatabaseLike,
  eventSlug: string,
  registrationId: string,
): Promise<RegistrationConfirmationInfo | null> {
  const loaded = await db.batch([
    db
      .prepare(
        `SELECT r.event_id,r.transition_revision,r.confirmation_link_secret,r.pending_confirmation_deadline_at,u.id AS user_id, u.normalized_email, u.first_name, u.last_name, ${REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL} AS email, ${REGISTRATION_ORGANIZATION_SQL} AS organization_name,
            e.name AS event_name
       FROM registrations r
       JOIN users u ON u.id = r.user_id

       JOIN events e ON e.id = r.event_id
      WHERE r.id = ?
        AND r.status = 'pending_email_confirmation'
        AND e.slug = ?
      LIMIT 1`,
      )
      .bind(registrationId, eventSlug),
  ]);
  return batchFirst<RegistrationConfirmationInfo>(loaded[0]);
}

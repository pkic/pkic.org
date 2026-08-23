import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL } from "./recipient-email";

export interface RegistrationConfirmationInfo {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  organization_name: string | null;
  event_name: string;
}

export function getRegistrationConfirmationInfo(
  db: DatabaseLike,
  eventSlug: string,
  registrationId: string,
): Promise<RegistrationConfirmationInfo | null> {
  return first<RegistrationConfirmationInfo>(
    db,
    `SELECT u.first_name, u.last_name, ${REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL} AS email, u.organization_name,
            e.name AS event_name
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       JOIN events e ON e.id = r.event_id
      WHERE r.id = ?
        AND r.status = 'pending_email_confirmation'
        AND e.slug = ?
      LIMIT 1`,
    [registrationId, eventSlug],
  );
}

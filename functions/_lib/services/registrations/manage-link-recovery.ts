import { first } from "../../db/queries";
import { prepareQueueEmailStatementWhen } from "../../email/outbox";
import type { DatabaseLike } from "../../types";
import { buildEventEmailVariables, type EventRecord } from "../events";
import { normalizeEmail } from "../../validation";
import { REGISTRATION_RECIPIENT_EMAIL_SQL } from "./recipient-email";
import { registrationManageCapability } from "./capability-urls";

interface RegistrationManageLinkMatch {
  registration_id: string;
  registration_status: string;
  manage_link_secret: string;
  registration_updated_at: string;
  user_id: string;
  email: string;
  normalized_email: string;
  first_name: string | null;
  last_name: string | null;
  user_updated_at: string;
}

/** Queues one enumeration-safe management-link recovery email when the match remains current. */
export async function queueRegistrationManageLinkRecovery(
  db: DatabaseLike,
  event: EventRecord,
  email: string,
  appBaseUrl: string,
): Promise<string | null> {
  const normalizedEmail = normalizeEmail(email);
  const registration = await first<RegistrationManageLinkMatch>(
    db,
    `SELECT
       r.id AS registration_id,
       r.status AS registration_status,
       r.manage_link_secret,
       r.updated_at AS registration_updated_at,
       u.id AS user_id,
       ${REGISTRATION_RECIPIENT_EMAIL_SQL} AS email,
       u.normalized_email,
       u.first_name,
       u.last_name,
       u.updated_at AS user_updated_at
     FROM users u
     JOIN registrations r ON r.user_id = u.id
     WHERE u.normalized_email = ?
       AND r.event_id = ?
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [normalizedEmail, event.id],
  );
  if (!registration) return null;

  const { manageUrl } = await registrationManageCapability(appBaseUrl, event, {
    id: registration.registration_id,
    manage_link_secret: registration.manage_link_secret,
  });
  const queued = prepareQueueEmailStatementWhen(
    db,
    {
      eventId: event.id,
      baseUrl: appBaseUrl,
      templateKey: "registration_manage_link",
      recipientEmail: registration.email,
      recipientUserId: registration.user_id,
      messageType: "transactional",
      capabilityLinkValues: [manageUrl],
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: registration.first_name ?? "",
        lastName: registration.last_name ?? "",
        email: registration.email,
        manageUrl,
        status: registration.registration_status,
      },
    },
    {
      sql: `SELECT 1
              FROM registrations r
              JOIN users u ON u.id = r.user_id
             WHERE r.id = ? AND r.event_id = ? AND r.updated_at = ?
               AND u.id = ? AND u.updated_at = ?
               AND u.normalized_email = ?`,
      bindings: [
        registration.registration_id,
        event.id,
        registration.registration_updated_at,
        registration.user_id,
        registration.user_updated_at,
        normalizedEmail,
      ],
    },
  );
  const result = await queued.statement.run();
  return result.meta?.changes === 1 ? queued.id : null;
}

import { first } from "../../db/queries";
import { prepareQueueEmailStatementWhen } from "../../email/outbox";
import type { DatabaseLike } from "../../types";
import { buildEventEmailVariables, type EventRecord } from "../events";
import { normalizeEmail } from "../../validation";
import {
  REGISTRATION_RECOVERY_RECIPIENT_EMAIL_SQL,
  REGISTRATION_RECOVERY_NORMALIZED_EMAIL_SQL,
} from "./recipient-email";
import { registrationManageCapability } from "./capability-urls";
import { myAgendaPageUrl } from "../frontend-links";

interface RegistrationManageLinkMatch {
  registration_id: string;
  registration_status: string;
  manage_link_secret: string;
  registration_updated_at: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  user_updated_at: string;
}

/**
 * Queues one enumeration-safe management-link recovery email when the match remains current.
 * `alreadyRegistered` answers a fresh registration attempt: only a held registration matches,
 * and the email says there is nothing to register again.
 */
export async function queueRegistrationManageLinkRecovery(
  db: DatabaseLike,
  event: EventRecord,
  email: string,
  appBaseUrl: string,
  options: { alreadyRegistered?: boolean } = {},
): Promise<string | null> {
  const alreadyRegistered = options.alreadyRegistered === true;
  const normalizedEmail = normalizeEmail(email);
  // Recovery may go to the account's login mailbox or this registration's recipient.
  const inputSql = "input(email) AS (VALUES (?))";
  const matchSql = `(u.normalized_email = input.email OR ${REGISTRATION_RECOVERY_NORMALIZED_EMAIL_SQL} = input.email)`;
  const recoveryEmailSql = `CASE WHEN u.normalized_email = input.email THEN u.email ELSE ${REGISTRATION_RECOVERY_RECIPIENT_EMAIL_SQL} END`;
  const registration = await first<RegistrationManageLinkMatch>(
    db,
    `WITH ${inputSql}, candidate_users AS (
       SELECT id FROM users WHERE normalized_email = (SELECT email FROM input)
       UNION
       SELECT user_id AS id FROM user_emails WHERE normalized_email = (SELECT email FROM input) AND verified_at IS NOT NULL
     ) SELECT
       r.id AS registration_id,
       r.status AS registration_status,
       r.manage_link_secret,
       r.updated_at AS registration_updated_at,
       u.id AS user_id,
       ${recoveryEmailSql} AS email,
       u.first_name,
       u.last_name,
       u.updated_at AS user_updated_at
     FROM candidate_users candidate JOIN users u ON u.id = candidate.id
     JOIN registrations r ON r.user_id = u.id CROSS JOIN input
     WHERE ${matchSql}
       AND r.event_id = ?
       AND (? = 0 OR r.status NOT IN ('cancelled', 'pending_email_confirmation'))
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [normalizedEmail, event.id, alreadyRegistered ? 1 : 0],
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
        myAgendaUrl: myAgendaPageUrl(appBaseUrl, event),
        status: registration.registration_status,
        alreadyRegistered,
      },
    },
    {
      sql: `WITH ${inputSql} SELECT 1
              FROM registrations r
              JOIN users u ON u.id = r.user_id CROSS JOIN input
             WHERE r.id = ? AND r.event_id = ? AND r.updated_at = ?
               AND u.id = ? AND u.updated_at = ?
               AND ${matchSql}
               AND ${recoveryEmailSql} = ?`,
      bindings: [
        normalizedEmail,
        registration.registration_id,
        event.id,
        registration.registration_updated_at,
        registration.user_id,
        registration.user_updated_at,
        registration.email,
      ],
    },
  );
  const result = await queued.statement.run();
  return result.meta?.changes === 1 ? queued.id : null;
}

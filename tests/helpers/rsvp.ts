import type { DatabaseLike } from "../../functions/_lib/types";
import { sha256Hex } from "../../functions/_lib/utils/crypto";
import { nowIso } from "../../functions/_lib/utils/time";
import { makeOwnEmailAddressPrimary } from "../../functions/_lib/services/own-email-addresses";
import { prepareVerifyPrimaryEmailStatements } from "../../functions/_lib/services/email-verification";

export async function seedRsvpRegistration(db: DatabaseLike): Promise<{ registrationId: string; userId: string }> {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const at = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO events
           (id, slug, name, timezone, starts_at, ends_at, source_path, capacity_in_person,
            registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
         VALUES (?, 'pqc-2026', 'PQC 2026', 'Europe/Amsterdam',
                 '2026-05-12T09:00:00.000Z', '2026-05-14T17:00:00.000Z',
                 'content/events/pqc-2026/_index.md', 100, 'open', 5, '{}', ?, ?)`,
      )
      .bind(eventId, at, at),
    db
      .prepare(
        `INSERT INTO users (id, email, normalized_email, active, created_at, updated_at)
         VALUES (?, 'alice@example.com', 'alice@example.com', 1, ?, ?)`,
      )
      .bind(userId, at, at),
    db
      .prepare(
        `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type,
            manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, 'registered', 'in_person', 'direct', ?, ?, ?)`,
      )
      .bind(registrationId, eventId, userId, await sha256Hex("manage-token"), at, at),
  ]);
  return { registrationId, userId };
}

/** Switch through the real primary-address use case, retaining the verified invited address. */
export async function switchRsvpRegistrationPrimaryEmail(db: DatabaseLike, userId: string): Promise<string> {
  const emailId = crypto.randomUUID();
  const at = nowIso();
  await db.batch([
    ...prepareVerifyPrimaryEmailStatements(db, {
      userId,
      normalizedEmail: "alice@example.com",
      method: "registration_confirmation",
      verifiedAt: at,
    }),
    db
      .prepare(
        "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,created_at) VALUES(?,?,'new-alice@example.test','new-alice@example.test',?,'magic_link',?)",
      )
      .bind(emailId, userId, at, at),
  ]);
  await makeOwnEmailAddressPrimary(db, { userId, emailId });
  return emailId;
}

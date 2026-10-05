import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { persistedUtcInstant } from "../../utils/time";
import { registrationSponsorSharingSchema } from "../../../../assets/shared/schemas/registration";
import type { RegistrationRecord } from "../registrations/types";

/** Only the currently active attendee term version authorizes sharing. Missing, withdrawn or replaced consent fails closed. */
export function sponsorConsentSql(registrationAlias: string): string {
  if (!/^[a-z_]+$/.test(registrationAlias)) throw new Error("Invalid registration SQL alias");
  return `EXISTS(SELECT 1 FROM consent_acceptances ca JOIN event_terms term ON term.event_id=ca.event_id AND term.audience_type='attendee' AND term.term_key='sponsor-data-sharing' AND term.version=ca.term_version AND term.active=1 WHERE ca.registration_id=${registrationAlias}.id AND ca.event_id=${registrationAlias}.event_id AND ca.user_id=${registrationAlias}.user_id AND ca.audience_type='attendee' AND ca.term_key='sponsor-data-sharing' AND ca.withdrawn_at IS NULL)`;
}

export async function readRegistrationSponsorSharing(
  db: DatabaseLike,
  registration: Pick<RegistrationRecord, "id" | "event_id" | "user_id">,
) {
  const row = await first<{ allowed: number; withdrawn_at: string | null }>(
    db,
    `SELECT ${sponsorConsentSql("r")} AS allowed,
       (SELECT MAX(ca.withdrawn_at) FROM consent_acceptances ca
         WHERE ca.registration_id=r.id AND ca.event_id=r.event_id AND ca.user_id=r.user_id
           AND ca.audience_type='attendee' AND ca.term_key='sponsor-data-sharing') AS withdrawn_at
     FROM registrations r WHERE r.id=? AND r.event_id=? AND r.user_id=?`,
    [registration.id, registration.event_id, registration.user_id],
  );
  if (!row) throw new AppError(409, "REGISTRATION_CHANGED", "Registration is no longer available.");
  return registrationSponsorSharingSchema.parse({
    allowed: Boolean(row.allowed),
    withdrawnAt: row.withdrawn_at === null ? null : persistedUtcInstant(row.withdrawn_at),
  });
}

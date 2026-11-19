import { emailAddressUndeliverableSql } from "../email-address-delivery";
import { ownedIdentityLifecycleSql } from "./selection";

/**
 * Where mail about a record made as an identity goes: a registration, a
 * proposal, a speaker's part in one. The record speaks for that identity, so
 * its mail goes to the verified address the identity uses, and to the
 * account's primary address when the identity uses that one, is no longer
 * active, or its address bounces or is blocked. Account mail (sign-in,
 * security notices) is not about a record and always goes to the primary.
 *
 * `identityIdSql` and `person` are trusted SQL: an identity id expression and
 * the alias of the users row that owns the record.
 */
export function recordRecipientEmailSql(
  identityIdSql: string,
  person = "u",
  column: "email" | "normalized_email" = "email",
): string {
  return `COALESCE((SELECT recipient_address.${column} FROM identities recipient_identity
    JOIN user_emails recipient_address ON recipient_address.id = recipient_identity.email_id
     AND recipient_address.user_id = recipient_identity.user_id AND recipient_address.verified_at IS NOT NULL
     AND NOT ${emailAddressUndeliverableSql("recipient_address")}
    WHERE recipient_identity.id = ${identityIdSql} AND recipient_identity.user_id = ${person}.id
      AND ${ownedIdentityLifecycleSql("recipient_identity", null)}), ${person}.${column})`;
}

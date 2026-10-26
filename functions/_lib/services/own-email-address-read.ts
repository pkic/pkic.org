/**
 * How a person's addresses read: the primary address on the account, with no
 * id of its own, and every added `user_emails` row. Account settings list
 * them all; the profile's address choice reads only the verified ones.
 */
import { secondaryEmailSignInAllowedSql } from "../auth/email-sign-in-policy";
import type { OwnEmailAddress } from "../../../assets/shared/schemas/own-email-addresses";
import type { EmailVerificationMethod } from "./email-verification";
import { all, first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export interface OwnAddressRow {
  id: string | null;
  email: string;
  is_primary: number;
  verified_at: string | null;
  verification_method: EmailVerificationMethod | null;
  identity_id: string | null;
  created_at: string;
  sign_in_enabled: number;
}

export const ADDRESS_SORT_EXPRESSIONS = { email: "LOWER(email)", created_at: "created_at" } as const;

/** Every address of one person as the `addresses` table; bind the person's id twice. */
export const OWN_ADDRESSES_SQL = `WITH addresses AS (
    SELECT NULL AS id, email, 1 AS is_primary, email_verified_at AS verified_at,
           email_verification_method AS verification_method, NULL AS identity_id, created_at, 1 AS sign_in_enabled
      FROM users WHERE id = ?
    UNION ALL
    SELECT id, email, 0, verified_at, verification_method, identity_id, created_at,
      (${secondaryEmailSignInAllowedSql("user_emails")}) AS sign_in_enabled FROM user_emails WHERE user_id = ?
    UNION ALL
    SELECT id,email,0,NULL,NULL,NULL,created_at,0 FROM user_email_claims
      WHERE user_id = (SELECT id FROM users WHERE id = ?1) AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  )`;

export const OWN_ADDRESS_COLUMNS =
  "id, email, is_primary, verified_at, verification_method, identity_id, created_at, sign_in_enabled";

export function toAddress(row: OwnAddressRow): OwnEmailAddress {
  return {
    id: row.id,
    email: row.email,
    primary: Boolean(row.is_primary),
    verifiedAt: row.verified_at,
    verificationMethod: row.verification_method,
    identityId: row.identity_id,
    createdAt: row.created_at,
    signInEnabled: Boolean(row.sign_in_enabled),
  };
}

/** One of the person's addresses; `emailId` null reads the primary address. */
export async function readOwnEmailAddress(
  db: DatabaseLike,
  userId: string,
  emailId: string | null,
): Promise<OwnEmailAddress> {
  const row = await first<OwnAddressRow>(
    db,
    `${OWN_ADDRESSES_SQL} SELECT ${OWN_ADDRESS_COLUMNS} FROM addresses WHERE id IS ? LIMIT 1`,
    [userId, userId, emailId],
  );
  if (!row) throw new AppError(404, "EMAIL_NOT_FOUND", "Email address not found");
  return toAddress(row);
}

/** The primary address and every verified one, primary first: the addresses an identity may follow. */
export async function readVerifiedOwnEmailAddresses(db: DatabaseLike, userId: string): Promise<OwnEmailAddress[]> {
  const rows = await all<OwnAddressRow>(
    db,
    `${OWN_ADDRESSES_SQL} SELECT ${OWN_ADDRESS_COLUMNS} FROM addresses
      WHERE is_primary = 1 OR verified_at IS NOT NULL ORDER BY is_primary DESC, email ASC`,
    [userId, userId],
  );
  return rows.map(toAddress);
}

import { setOwnEmailSignInPermission } from "./own-email-sign-in";
/**
 * The signed-in person manages their own email addresses.
 *
 * Addresses are the same `user_emails` rows staff manage (user-emails.ts
 * builds the shared insert and removal statements), so one global
 * reservation, one identity-ownership rule and one audit trail cover both.
 * Adding an address sends its verification link in the same command
 * (own-email-verification.ts redeems it). Making an address primary swaps it
 * with the current primary address while every organization identity keeps
 * the address it follows. An address an active organization identity uses
 * cannot be removed: the identity would silently fall back to another one.
 */
import {
  OWN_EMAIL_ADDRESS_LIMIT,
  type OwnEmailAddress,
  type OwnEmailAddressUpdate,
  type OwnEmailAddressesListQuery,
} from "../../../assets/shared/schemas/own-email-addresses";
import { buildPageInfo, type PageInfo } from "../../../assets/shared/schemas/pagination";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../db/authorization-guard";
import { first } from "../db/queries";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { normalizeEmail } from "../validation";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import {
  ADDRESS_SORT_EXPRESSIONS,
  OWN_ADDRESSES_SQL,
  OWN_ADDRESS_COLUMNS,
  readOwnEmailAddress,
  toAddress,
  type OwnAddressRow,
} from "./own-email-address-read";
import { prepareOwnEmailVerificationMessage, type OwnEmailVerificationDelivery } from "./own-email-verification";
import {
  emailTakenError,
  findUserEmailOwner,
  isEmailReservationConflict,
  prepareInsertUserEmail,
  prepareRemoveUserEmailStatements,
} from "./user-emails";

export async function listOwnEmailAddresses(
  db: DatabaseLike,
  userId: string,
  query: OwnEmailAddressesListQuery,
): Promise<{ emails: OwnEmailAddress[]; page: PageInfo }> {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["email"]) : null;
  const { rows, total } = await queryPage<OwnAddressRow>(db, {
    source: {
      withSql: OWN_ADDRESSES_SQL,
      selectSql: `SELECT ${OWN_ADDRESS_COLUMNS}`,
      fromSql: `FROM addresses${search ? ` WHERE ${search.sql}` : ""}`,
      bindings: [userId, userId, ...(search?.bindings ?? [])],
    },
    // The primary address leads whatever order the reader picks.
    orderBy: resolveMappedOrderBy(query.sort, ADDRESS_SORT_EXPRESSIONS, "created_at ASC", "id ASC").replace(
      "ORDER BY ",
      "ORDER BY is_primary DESC, ",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  const emails = rows.map(toAddress);
  return { emails, page: buildPageInfo(query.limit, query.offset, total, emails.length) };
}

/** Adds an unverified address and sends its verification link in one command. */
export async function addOwnEmailAddress(
  db: DatabaseLike,
  input: { userId: string; email: string } & OwnEmailVerificationDelivery,
): Promise<{ email: OwnEmailAddress; outboxId: string }> {
  const [user, count] = await Promise.all([
    first<{ updated_at: string }>(
      db,
      "SELECT updated_at FROM users WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
      [input.userId],
    ),
    first<{ count: number }>(db, "SELECT COUNT(*) AS count FROM user_emails WHERE user_id = ?", [input.userId]),
  ]);
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  if (Number(count?.count ?? 0) >= OWN_EMAIL_ADDRESS_LIMIT)
    throw new AppError(
      409,
      "USER_EMAIL_LIMIT_REACHED",
      `You can keep up to ${OWN_EMAIL_ADDRESS_LIMIT} addresses besides your primary one; remove one first`,
    );
  if (await findUserEmailOwner(db, normalizeEmail(input.email))) throw emailTakenError();
  const id = uuid();
  const at = nowIso();
  const message = await prepareOwnEmailVerificationMessage(db, { ...input, emailId: id, at });
  try {
    await db.batch([
      prepareInsertUserEmail(db, { id, userId: input.userId, email: input.email, at, userUpdatedAt: user.updated_at }),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        input.userId,
        "user_email_added",
        "user",
        input.userId,
        { emailId: id, email: input.email },
        at,
      ),
      ...message.statements,
    ]);
  } catch (error) {
    if (isEmailReservationConflict(error)) throw emailTakenError();
    if (isAuditChangeGuardFailure(error))
      throw new AppError(409, "USER_LIFECYCLE_CHANGED", "Your account changed while the address was being added");
    throw error;
  }
  return { email: await readOwnEmailAddress(db, input.userId, id), outboxId: message.outboxId };
}

interface SwapParty {
  user_updated_at: string;
  pending_email: string | null;
  primary_email: string;
  primary_normalized: string;
  primary_verified_at: string | null;
  primary_method: string | null;
  email: string;
  normalized_email: string;
  verified_at: string | null;
  verification_method: string | null;
}

/**
 * Makes a verified address primary. The address row and the account swap
 * their text and proof, so the old primary address stays on the account as
 * an added address under the row's id. An organization identity that
 * followed the chosen address now follows the primary one, and one that
 * followed the old primary address follows the row, so each keeps its
 * address; the row belongs to that identity when exactly one follows it.
 */
export async function makeOwnEmailAddressPrimary(
  db: DatabaseLike,
  input: { userId: string; emailId: string },
): Promise<OwnEmailAddress> {
  const party = await first<SwapParty>(
    db,
    `SELECT person.updated_at AS user_updated_at, person.pending_email, person.email AS primary_email,
            person.normalized_email AS primary_normalized, person.email_verified_at AS primary_verified_at,
            person.email_verification_method AS primary_method, address.email, address.normalized_email,
            address.verified_at, address.verification_method
       FROM user_emails address JOIN users person ON person.id = address.user_id
      WHERE address.id = ? AND address.user_id = ? AND person.active = 1`,
    [input.emailId, input.userId],
  );
  if (!party) throw new AppError(404, "EMAIL_NOT_FOUND", "Email address not found");
  if (!party.verified_at)
    throw new AppError(409, "EMAIL_UNVERIFIED", "Verify this address before making it your primary address");
  if (party.pending_email)
    throw new AppError(409, "EMAIL_CHANGE_PENDING", "Confirm or cancel your pending email change first");
  const at = nowIso();
  const { emailId, userId } = input;
  const followers = `SELECT follower.id FROM identities follower
    WHERE follower.user_id = ? AND follower.email_id = ? AND follower.ended_at IS NULL`;
  const statements = [
    // The row steps out of the shared reservation while the account takes its address.
    db
      .prepare("UPDATE user_emails SET normalized_email = '#primary-swap:' || id WHERE id = ? AND user_id = ?")
      .bind(emailId, userId),
    db
      .prepare(
        `UPDATE users SET email = ?, normalized_email = ?, email_verified_at = ?, email_verification_method = ?,
                updated_at = ?
          WHERE id = ? AND updated_at = ? AND normalized_email = ? AND pending_email IS NULL`,
      )
      .bind(
        party.email,
        party.normalized_email,
        party.verified_at,
        party.verification_method,
        at,
        userId,
        party.user_updated_at,
        party.primary_normalized,
      ),
    prepareAuditLogAfterOneChange(
      db,
      "user",
      userId,
      "user_primary_email_changed",
      "user",
      userId,
      { email: { from: party.primary_email, to: party.email }, emailId },
      at,
    ),
    db
      .prepare(
        `UPDATE user_emails SET email = ?, normalized_email = ?, verified_at = ?, verification_method = ?,
                identity_id = NULL
          WHERE id = ? AND user_id = ?`,
      )
      .bind(
        party.primary_email,
        party.primary_normalized,
        party.primary_verified_at,
        party.primary_method,
        emailId,
        userId,
      ),
    // Each organization identity keeps its own address; an unverified old primary cannot be followed.
    db
      .prepare(
        `UPDATE identities SET email_id = CASE WHEN email_id = ? THEN NULL ELSE ? END, updated_at = ?
          WHERE user_id = ? AND organization_id IS NOT NULL
            AND (email_id = ? OR (email_id IS NULL AND ? IS NOT NULL))`,
      )
      .bind(emailId, emailId, at, userId, emailId, party.primary_verified_at),
    db
      .prepare(
        `UPDATE user_emails SET identity_id = CASE WHEN (SELECT COUNT(*) FROM (${followers})) = 1
                THEN (${followers}) END
          WHERE id = ? AND user_id = ?`,
      )
      .bind(userId, emailId, userId, emailId, emailId, userId),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error) || isEmailReservationConflict(error))
      throw new AppError(409, "USER_LIFECYCLE_CHANGED", "Your account changed meanwhile; reload and try again");
    throw error;
  }
  return readOwnEmailAddress(db, userId, null);
}

/** Removes an added address no active organization identity uses. */
export async function removeOwnEmailAddress(
  db: DatabaseLike,
  input: { userId: string; emailId: string },
): Promise<void> {
  const address = await first<{ email: string; organization_name: string | null }>(
    db,
    `SELECT address.email,
            (SELECT organization.name FROM identities identity
               JOIN organizations organization ON organization.id = identity.organization_id
              WHERE identity.user_id = address.user_id AND identity.ended_at IS NULL
                AND (identity.email_id = address.id OR identity.id = address.identity_id)
              LIMIT 1) AS organization_name
       FROM user_emails address WHERE address.id = ? AND address.user_id = ?`,
    [input.emailId, input.userId],
  );
  if (!address) throw new AppError(404, "EMAIL_NOT_FOUND", "Email address not found");
  if (address.organization_name)
    throw new AppError(
      409,
      "USER_EMAIL_IN_USE",
      `This address identifies you at ${address.organization_name}; end that relationship first`,
    );
  const at = nowIso();
  try {
    await db.batch([
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM identities identity WHERE identity.user_id = ?
                AND identity.email_id = ? AND identity.ended_at IS NULL)`,
        bindings: [input.userId, input.emailId],
      }),
      ...prepareRemoveUserEmailStatements(db, { ...input, at }),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        input.userId,
        "user_email_removed",
        "user",
        input.userId,
        { emailId: input.emailId, email: address.email },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(409, "USER_EMAIL_IN_USE", "An organization identity started using this address meanwhile");
    if (isAuditChangeGuardFailure(error)) throw new AppError(404, "EMAIL_NOT_FOUND", "Email address not found");
    throw error;
  }
}

/** One canonical update contract for the account owner's address choices. */
export async function updateOwnEmailAddress(
  db: DatabaseLike,
  input: { userId: string; emailId: string; update: OwnEmailAddressUpdate },
) {
  return "primary" in input.update
    ? makeOwnEmailAddressPrimary(db, input)
    : setOwnEmailSignInPermission(db, {
        userId: input.userId,
        emailId: input.emailId,
        enabled: input.update.signInEnabled,
      });
}

import { refuseIneligibleWorkEmail } from "../email-domains/work-email-screen";
import { prepareJobWake } from "./scheduled-jobs/dispatcher";
import { prepareMailingListEmailChange } from "./mailing-list-subscriptions/queue-email-change";
import { setOwnEmailSignInPermission } from "./own-email-sign-in";
import { refuseRemovingLastSignInMethod } from "../auth/sign-in-methods";
/**
 * The signed-in person manages their own email addresses.
 *
 * Verification requests use the shared signed email challenge and outbox. No
 * address is saved until mailbox proof and the intended account's explicit
 * confirmation. Saved addresses are canonical user_emails records, shared
 * with staff-managed addresses. Making a verified address primary swaps it
 * with the current primary address while every organization identity keeps
 * the address it follows. An address an active organization identity uses
 * cannot be removed: the identity would silently fall back to another one.
 */
import {
  OWN_EMAIL_ADDRESS_LIMIT,
  OWN_EMAIL_ALREADY_ON_ACCOUNT,
  OWN_EMAIL_ALREADY_ON_ACCOUNT_MESSAGES,
  ownEmailInUseMessage,
  type OwnEmailHolding,
  type OwnEmailAddress,
  type OwnEmailAddressUpdate,
  type OwnEmailAddressesListQuery,
} from "../../../assets/shared/schemas/own-email-addresses";
import { buildPageInfo, type PageInfo } from "../../../assets/shared/schemas/pagination";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../db/authorization-guard";
import { first } from "../db/queries";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { DatabaseLike, D1StatementResult } from "../types";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { normalizeEmail } from "../validation";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange, prepareAuditLog } from "./audit";
import {
  ADDRESS_SORT_EXPRESSIONS,
  addressUsedByJsonSql,
  decodeAddressUsedBy,
  OWN_ADDRESSES_SQL,
  OWN_ADDRESS_COLUMNS,
  readOwnEmailAddress,
  toAddress,
  type OwnAddressRow,
} from "./own-email-address-read";
import { prepareOwnEmailVerificationMessage, type OwnEmailVerificationDelivery } from "./own-email-verification";
import { isEmailReservationConflict, prepareRemoveUserEmailStatements } from "./user-emails";
import { domainBackedIdentitySql, identityEmailDomainSupportSql } from "./identities/email-domain-support";
import { identityOrganizationEmailDomainSql } from "./identities/affiliation-projection";

export function prepareOwnEmailAddressesList(
  db: DatabaseLike,
  userId: string,
  query: OwnEmailAddressesListQuery,
  availableToIdentityId?: string,
) {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["email"]) : null;
  const conditions = [...(search ? [search.sql] : [])];
  const bindings: unknown[] = [userId, userId, ...(search?.bindings ?? [])];
  if (availableToIdentityId) {
    conditions.push("verified_at IS NOT NULL AND (identity_id IS NULL OR identity_id=?)");
    bindings.push(availableToIdentityId);
    conditions.push(`EXISTS (SELECT 1 FROM identities identity WHERE identity.id=? AND
      (NOT ${domainBackedIdentitySql()} OR ${identityEmailDomainSupportSql(
        "lower(addresses.email)",
        "identity",
        identityOrganizationEmailDomainSql("identity.id"),
      )}))`);
    bindings.push(availableToIdentityId);
  }
  const statements = buildOffsetPageStatements(db, {
    source: {
      withSql: OWN_ADDRESSES_SQL,
      selectSql: `SELECT ${OWN_ADDRESS_COLUMNS}`,
      fromSql: `FROM addresses${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}`,
      bindings,
    },
    // The primary address leads whatever order the reader picks.
    orderBy: resolveMappedOrderBy(query.sort, ADDRESS_SORT_EXPRESSIONS, "created_at ASC", "id ASC").replace(
      "ORDER BY ",
      "ORDER BY is_primary DESC, ",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return {
    statements,
    decode(loaded: D1StatementResult[]) {
      const { rows, total } = decodeOffsetPageResults<OwnAddressRow>(loaded[0]!, loaded[1]!);
      const emails = rows.map(toAddress);
      return { emails, page: buildPageInfo(query.limit, query.offset, total, emails.length) };
    },
  };
}

export async function listOwnEmailAddresses(
  db: DatabaseLike,
  userId: string,
  query: OwnEmailAddressesListQuery,
): Promise<{ emails: OwnEmailAddress[]; page: PageInfo }> {
  const read = prepareOwnEmailAddressesList(db, userId, query);
  return read.decode(await db.batch(read.statements));
}

/** The person's own verified addresses that equal one requested address; bind user id and address twice. */
const OWN_VERIFIED_HOLDING_SQL = `SELECT 'primary' AS holding FROM users WHERE id=? AND normalized_email=?
  UNION ALL
  SELECT 'verified' FROM user_emails WHERE user_id=? AND normalized_email=? AND verified_at IS NOT NULL`;

/**
 * Request proof without reserving the address or associating its owner with
 * this account. An address this account already holds verified is refused
 * before any mail goes out, since its link could only fail once opened. A
 * saved address still waiting for proof may be requested again. Only the
 * person's own addresses are named; another account's reservation stays
 * undisclosed.
 */
export async function addOwnEmailAddress(
  db: DatabaseLike,
  input: {
    userId: string;
    email: string;
    purpose?: "representation";
    unaffiliatedAttestation?: boolean;
  } & OwnEmailVerificationDelivery,
): Promise<{ status: "verification_sent"; email: string; requestId: string; outboxId: string }> {
  if (input.purpose === "representation")
    refuseIneligibleWorkEmail({ email: input.email, unaffiliatedAttestation: input.unaffiliatedAttestation ?? false });
  const id = uuid();
  const at = nowIso();
  const normalizedEmail = normalizeEmail(input.email);
  const message = await prepareOwnEmailVerificationMessage(db, { ...input, emailId: id, addressRequest: true, at });
  try {
    await db.batch([
      ...(input.authorizationEvidence ? [prepareAuthorizationGuard(db, input.authorizationEvidence)] : []),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND email_verified_at IS NOT NULL AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
        bindings: [input.userId],
      }),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 WHERE (SELECT COUNT(*) FROM user_emails WHERE user_id=?) < ?",
        bindings: [input.userId, OWN_EMAIL_ADDRESS_LIMIT],
      }),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS (${OWN_VERIFIED_HOLDING_SQL})`,
        bindings: [input.userId, normalizedEmail, input.userId, normalizedEmail],
      }),
      prepareAuditLog(
        db,
        "user",
        input.userId,
        "user_email_requested",
        "user",
        input.userId,
        { requestId: id, email: input.email },
        at,
      ),
      ...message.statements,
    ]);
  } catch (error) {
    if (!isAuthorizationGuardFailure(error)) throw error;
    // Only a refused request pays for reading which reason applies.
    const held = await first<{ holding: OwnEmailHolding }>(db, `${OWN_VERIFIED_HOLDING_SQL} LIMIT 1`, [
      input.userId,
      normalizedEmail,
      input.userId,
      normalizedEmail,
    ]);
    if (held)
      throw new AppError(409, OWN_EMAIL_ALREADY_ON_ACCOUNT, OWN_EMAIL_ALREADY_ON_ACCOUNT_MESSAGES[held.holding]);
    throw new AppError(
      409,
      "EMAIL_REQUEST_NOT_ALLOWED",
      "Confirm your sign-in email and check your saved email addresses before requesting another link.",
    );
  }
  return { status: "verification_sent", email: input.email, requestId: id, outboxId: message.outboxId };
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
  if (!party) {
    throw new AppError(404, "EMAIL_NOT_FOUND", "Email address not found");
  }
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
  statements.push(...prepareMailingListEmailChange(db, userId, at));
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
  const address = await first<{ email: string; used_by_json: string }>(
    db,
    `SELECT address.email, ${addressUsedByJsonSql("address")} AS used_by_json
       FROM user_emails address WHERE address.id = ? AND address.user_id = ?`,
    [input.emailId, input.userId],
  );
  if (!address) throw new AppError(404, "EMAIL_NOT_FOUND", "Email address not found");
  const usedBy = decodeAddressUsedBy(address.used_by_json);
  if (usedBy.length)
    throw new AppError(409, "USER_EMAIL_IN_USE", ownEmailInUseMessage(usedBy.map((organization) => organization.name)));
  const remains = await refuseRemovingLastSignInMethod(db, input.userId, { removedEmailId: input.emailId });
  const at = nowIso();
  try {
    await db.batch([
      prepareAuthorizationGuard(db, remains),
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
      prepareJobWake(db, "google_groups_sync"),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      // The batch rolled back; asking again names the guard that refused.
      await refuseRemovingLastSignInMethod(db, input.userId, { removedEmailId: input.emailId });
      throw new AppError(409, "USER_EMAIL_IN_USE", "An organization identity started using this address meanwhile");
    }
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

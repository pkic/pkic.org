import { sessionEmailSignInAllowedSql } from "./email-sign-in-policy";
/** Fresh, request-scoped preload for the canonical claims resolver; no cached authority. */
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import {
  resolveSessionActingIdentityId,
  type SessionActingIdentity,
} from "../../../assets/shared/session-acting-identity";
import { batchRows } from "../db/pagination";
import { AppError } from "../errors";
import type { D1StatementResult, DatabaseLike, PermissionGrant } from "../types";
import { EVENT_PARTICIPATION_SQL } from "./event-participation";
import {
  activeIdentityPredicate,
  MEMBER_ELIGIBLE_USER_SELECT,
  MEMBER_ELIGIBLE_USER_COLUMNS,
  STAFF_ACCESS_CONDITION,
  selectActingMember,
  type EligibleStaffUser,
  type MemberEligibleUserRow,
} from "./identity-capacities";
import { prepareUserGrantCandidates, selectUserGrantCandidates, type ContextGrantRow } from "./permissions";
import type { PlainSessionRow } from "./session-engine";
import {
  MAX_ACTING_IDENTITIES,
  SESSION_ACTING_IDENTITY_MEMBERSHIP_LABEL_SQL,
  SESSION_ACTING_IDENTITY_MEMBERSHIP_SQL,
  SESSION_ACTING_IDENTITY_ORDER_SQL,
} from "./session-acting-identities";
import { ACTIVE_EVENT_SPONSORSHIP_SQL, toSponsorCapacity, type SponsorshipCapacityRow } from "./sponsor-capacity";
import { resolveUserSessionClaims } from "./user-session-claims";
import type { UserSessionResult } from "./user-session-result";
import type { UserSessionTokenClaims } from "./user-session-token";

export interface UserSessionLiveData {
  row: PlainSessionRow | null;
  identity: { id: string; email: string; normalized_email: string } | null;
  staff: EligibleStaffUser | null;
  memberships: MemberEligibleUserRow[];
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
  eventParticipation: boolean;
  affiliation: boolean;
  actingIdentities: SessionActingIdentity[];
  grants: PermissionGrant[];
}
export type UserSessionBatchResult = { ok: true; session: UserSessionResult } | { ok: false; error: AppError };
const CHUNK_SIZE = 512;
interface UserRow {
  id: string;
  email: string;
  normalized_email: string;
  active: number;
  staff: number;
  pending: number;
  eventParticipation: number;
  affiliation: number;
}
interface ActingRow {
  user_id: string;
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  job_title: string | null;
  membership_category: string | null;
  membership_label: string | null;
}
function group<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = result.get(id) ?? [];
    list.push(row);
    result.set(id, list);
  }
  return result;
}
/** Aligned per-claim results: DB rows deduplicate, claim-specific idle/identity/state policy does not. */
/** Prepare canonical live claims for composition with an authorized resource read. */
export function prepareUserSessionClaimsBatch(db: DatabaseLike, slice: readonly UserSessionTokenClaims[]) {
  if (slice.length > CHUNK_SIZE) throw new Error("Session claims batch exceeds its bounded chunk size");
  const userIds = JSON.stringify([...new Set(slice.map((claim) => claim.sub))]);
  const pairs = JSON.stringify([
    ...new Map(
      slice.map((claim) => [JSON.stringify([claim.sid, claim.sub]), { sid: claim.sid, sub: claim.sub }]),
    ).values(),
  ]);
  const statements = [
    db
      .prepare(
        `SELECT s.id, s.user_id AS subjectId, s.expires_at AS expiresAt, s.created_at AS createdAt, s.revoked_at AS revokedAt FROM json_each(?) requested JOIN sessions s ON s.id=json_extract(requested.value,'$.sid') AND s.user_id=json_extract(requested.value,'$.sub') WHERE ${sessionEmailSignInAllowedSql("s.id", "s.user_id")}`,
      )
      .bind(pairs),
    db
      .prepare(
        `SELECT u.id,u.email,u.normalized_email,u.active, ${STAFF_ACCESS_CONDITION} AS staff,
        (SELECT count(*) FROM identities i WHERE i.user_id=u.id AND i.started_at IS NULL AND i.ended_at IS NULL AND i.blocked_at IS NULL) AS pending,
        (u.pii_redacted_at IS NULL AND ${EVENT_PARTICIPATION_SQL.replaceAll("user.id", "u.id")}) AS eventParticipation,
        (u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL AND ${activeIdentityPredicate("u")}) AS affiliation
        FROM users u JOIN json_each(?) requested ON requested.value=u.id
        WHERE u.active=1 AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL`,
      )
      .bind(userIds),
    db
      .prepare(
        `SELECT ${MEMBER_ELIGIBLE_USER_COLUMNS.split(", ")
          .map((column) => `combined.${column}`)
          .join(
            ", ",
          )} FROM (${MEMBER_ELIGIBLE_USER_SELECT}) combined JOIN json_each(?) requested ON requested.value=combined.id WHERE combined.active=1 ORDER BY combined.id,combined.sort_key`,
      )
      .bind(userIds),
    db
      .prepare(
        `WITH addresses(user_id,normalized_email) AS (
        SELECT u.id,u.normalized_email FROM users u JOIN json_each(?) requested ON requested.value=u.id WHERE u.active=1
        UNION SELECT u.id,ue.normalized_email FROM users u JOIN json_each(?) requested ON requested.value=u.id JOIN user_emails ue ON ue.user_id=u.id WHERE u.active=1 AND ue.verified_at IS NOT NULL)
        SELECT addresses.user_id,s.id,s.event_id,e.slug AS event_slug,e.name AS event_name,s.tier,s.contact_email
        FROM addresses JOIN sponsorships s ON lower(trim(s.contact_email))=addresses.normalized_email JOIN events e ON e.id=s.event_id
        WHERE ${ACTIVE_EVENT_SPONSORSHIP_SQL} ORDER BY addresses.user_id,lower(COALESCE(e.name,e.slug)),lower(COALESCE(s.tier,'')),s.id`,
      )
      .bind(userIds, userIds),
    db
      .prepare(
        `SELECT user_id,id,organization_id,organization_name,job_title,membership_category,membership_label FROM (
        SELECT identity.user_id,identity.id,identity.organization_id,organization.name AS organization_name,identity.job_title,${SESSION_ACTING_IDENTITY_MEMBERSHIP_SQL} AS membership_category,${SESSION_ACTING_IDENTITY_MEMBERSHIP_LABEL_SQL} AS membership_label,
        row_number() OVER (PARTITION BY identity.user_id ORDER BY ${SESSION_ACTING_IDENTITY_ORDER_SQL}) AS ordinal
        FROM identities identity JOIN json_each(?) requested ON requested.value=identity.user_id LEFT JOIN organizations organization ON organization.id=identity.organization_id
        WHERE identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL)
        WHERE ordinal<=? ORDER BY user_id,ordinal`,
      )
      .bind(userIds, MAX_ACTING_IDENTITIES),
    prepareUserGrantCandidates(
      db,
      slice.map((claim) => claim.sub),
    ),
  ];

  return {
    statements,
    grantsForContext(loaded: D1StatementResult[], requestIndex: number, memberId: string | null) {
      return selectUserGrantCandidates(batchRows<ContextGrantRow>(loaded[5]), requestIndex, memberId);
    },
    async decode(loaded: D1StatementResult[]): Promise<UserSessionBatchResult[]> {
      const result: UserSessionBatchResult[] = [];
      const sessions = batchRows<PlainSessionRow>(loaded[0]);
      const users = batchRows<UserRow>(loaded[1]);
      const memberships = batchRows<MemberEligibleUserRow>(loaded[2]);
      const sponsors = batchRows<SponsorshipCapacityRow & { user_id: string }>(loaded[3]);
      const acting = batchRows<ActingRow>(loaded[4]);
      const grantRows = batchRows<ContextGrantRow>(loaded[5]);
      const sessionMap = new Map(sessions.map((row) => [JSON.stringify([row.id, row.subjectId]), row]));
      const userMap = new Map(users.map((row) => [row.id, row]));
      const memberMap = group(memberships, (row) => row.id),
        sponsorMap = group(sponsors, (row) => row.user_id),
        actingMap = group(acting, (row) => row.user_id);
      const data = slice.map((claim): UserSessionLiveData => {
        const user = userMap.get(claim.sub);
        return {
          row: sessionMap.get(JSON.stringify([claim.sid, claim.sub])) ?? null,
          identity: user ?? null,
          staff: user?.staff ? { id: user.id, email: user.email, active: user.active } : null,
          memberships: memberMap.get(claim.sub) ?? [],
          sponsors: (sponsorMap.get(claim.sub) ?? []).map(toSponsorCapacity),
          pendingIdentityCount: Number(user?.pending ?? 0),
          eventParticipation: Boolean(user?.eventParticipation),
          affiliation: Boolean(user?.affiliation),
          actingIdentities: (actingMap.get(claim.sub) ?? []).map((row) => ({
            id: row.id,
            organizationId: row.organization_id,
            organizationName: row.organization_name,
            jobTitle: row.job_title,
            membershipCategory: row.membership_category,
            membershipLabel: row.membership_label,
          })),
          grants: [],
        };
      });
      for (let index = 0; index < slice.length; index++) {
        data[index].grants = selectUserGrantCandidates(
          grantRows,
          index,
          selectActingMember(
            data[index].memberships,
            resolveSessionActingIdentityId(data[index].actingIdentities, slice[index].iid),
          )?.memberId ?? null,
        );
        try {
          result.push({ ok: true, session: await resolveUserSessionClaims(db, slice[index], data[index], false) });
        } catch (error) {
          if (error instanceof AppError && error.status >= 400 && error.status < 500) result.push({ ok: false, error });
          else throw error;
        }
      }

      return result;
    },
  };
}

export async function resolveUserSessionClaimsBatch(
  db: DatabaseLike,
  claims: readonly UserSessionTokenClaims[],
): Promise<UserSessionBatchResult[]> {
  const result: UserSessionBatchResult[] = [];
  for (let offset = 0; offset < claims.length; offset += CHUNK_SIZE) {
    const read = prepareUserSessionClaimsBatch(db, claims.slice(offset, offset + CHUNK_SIZE));
    result.push(...(await read.decode(await db.batch(read.statements))));
  }
  return result;
}

/**
 * Member profile, applications, and notification self-service. All
 * functions here operate on the caller's own AuthMember identity — current-user
 * resource routes never accept a target user/member id, by design.
 */
import { all, first } from "../db/queries";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { nowIso } from "../utils/time";
import { stringifyJson, parseJsonSafe } from "../utils/json";
import { parseLinksJson, serializeLinks } from "../../../assets/shared/schemas/links";
import { AppError } from "../errors";
import { getMemberApplicationById } from "./membership/applications/queries";
import { resolveRepresentativeRoleHolders } from "./membership/representative-roles";
import type { AuthMember, DatabaseLike, EligibleIdentity } from "../types";
import type { MyApplicationsListQuery } from "../../../assets/shared/schemas/me";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { publicUserHeadshotPath } from "./user-headshot";
import { memberSessionAuthorizationEvidence } from "../auth/identity-capacities";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../db/authorization-guard";
import type { EmailVerificationMethod } from "./email-verification";

export interface MyActingIdentity {
  identityId: string;
  userId: string;
  name: string | null;
  email: string;
  showOnOrgProfile: boolean;
  isPrimaryContact: boolean;
  isSecondaryContact: boolean;
}

export interface MyProfile {
  userId: string;
  emailId: string | null;
  email: string;
  emailAddresses: Array<{
    id: string | null;
    email: string;
    primary: boolean;
    verifiedAt: string | null;
    verificationMethod: EmailVerificationMethod | null;
  }>;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  jobTitle: string | null;
  biography: string | null;
  links: string[];
  membershipCategory: string;
  organizationId: string | null;
  organizationName: string | null;
  memberSince: string;
  showOnOrgProfile: boolean;
  headshotUrl: string | null;
  /** True when this member is their organization's primary or secondary contact. */
  isOrgContact: boolean;
  /** Full active identity roster for the caller's organization; null when org-less. */
  organizationIdentities: MyActingIdentity[] | null;
  /**
   * Every membership context this member is currently eligible to act
   * through (see AuthMember.activeIdentities) — lets a person who
   * represents more than one organization see, and switch, which one is
   * currently active via PUT /api/v1/users/current/identities/active.
   */
  activeIdentities: EligibleIdentity[];
}

interface MyProfileRow {
  email_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  category_code: string;
  organization_id: string | null;
  show_on_org_profile: number;
  headshot_r2_key: string | null;
  member_since: string | null;
  member_created_at: string;
  org_name: string | null;
}

interface ActingIdentityRow {
  identity_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string;
  show_on_org_profile: number;
}

function identityDisplayName(row: ActingIdentityRow): string | null {
  if (row.preferred_name) return row.preferred_name;
  const full = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return full || null;
}

function toProfile(
  row: MyProfileRow,
  member: AuthMember,
  emailAddresses: MyProfile["emailAddresses"],
  organizationIdentities: MyActingIdentity[] | null,
  isOrgContact: boolean,
): MyProfile {
  return {
    userId: member.userId,
    emailId: row.email_id,
    email: row.email,
    emailAddresses,
    firstName: row.first_name,
    lastName: row.last_name,
    preferredName: row.preferred_name,
    jobTitle: row.job_title,
    biography: row.biography,
    links: parseLinksJson(row.links_json),
    membershipCategory: row.category_code,
    organizationId: row.organization_id,
    organizationName: row.org_name,
    memberSince: row.member_since ?? row.member_created_at,
    showOnOrgProfile: row.show_on_org_profile === 1,
    headshotUrl: publicUserHeadshotPath(row.headshot_r2_key),
    isOrgContact,
    organizationIdentities,
    activeIdentities: member.activeIdentities,
  };
}

export async function getMyProfile(db: DatabaseLike, member: AuthMember): Promise<MyProfile> {
  const row = await first<MyProfileRow>(
    db,
    `SELECT identity.email_id,
            COALESCE(selected_email.email, u.email) AS email,
            u.first_name, u.last_name, u.preferred_name,
            identity.job_title, identity.biography, identity.links_json,
            u.headshot_r2_key, mca.category_code, m.organization_id,
            identity.show_on_organization_profile AS show_on_org_profile,
            m.member_since, m.created_at AS member_created_at, o.name AS org_name
     FROM identities identity
     JOIN users u ON u.id = identity.user_id
     JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
     JOIN members m ON m.id = capacity.member_id
     JOIN member_category_assignments mca ON mca.member_id = m.id
     LEFT JOIN organizations o ON o.id = m.organization_id
     LEFT JOIN user_emails selected_email
       ON selected_email.id = identity.email_id
      AND selected_email.user_id = identity.user_id
      AND selected_email.verified_at IS NOT NULL
     WHERE identity.id = ? AND identity.user_id = ?
       AND identity.started_at IS NOT NULL
       AND identity.ended_at IS NULL
       AND identity.blocked_at IS NULL`,
    [member.identityId, member.userId],
  );
  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Profile not found");
  }

  const emailAddresses = await all<{
    id: string | null;
    email: string;
    is_primary: number;
    verified_at: string | null;
    verification_method: EmailVerificationMethod | null;
  }>(
    db,
    `SELECT NULL AS id, email, 1 AS is_primary, email_verified_at AS verified_at,
            email_verification_method AS verification_method
       FROM users WHERE id = ?
     UNION ALL
     SELECT id, email, 0 AS is_primary, verified_at, verification_method
       FROM user_emails
      WHERE user_id = ? AND verified_at IS NOT NULL
      ORDER BY 3 DESC, email ASC`,
    [member.userId, member.userId],
  ).then((addresses) =>
    addresses.map((address) => ({
      id: address.id,
      email: address.email,
      primary: address.is_primary === 1,
      verifiedAt: address.verified_at,
      verificationMethod: address.verification_method,
    })),
  );

  let organizationIdentities: MyActingIdentity[] | null = null;
  let isOrgContact = false;
  if (row.organization_id) {
    const [repRows, holders] = await Promise.all([
      all<ActingIdentityRow>(
        db,
        `SELECT identity.id AS identity_id, u.id AS user_id, u.first_name, u.last_name, u.preferred_name,
                COALESCE(selected_email.email, u.email) AS email,
                identity.show_on_organization_profile AS show_on_org_profile
         FROM identities identity
         JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
         JOIN users u ON u.id = identity.user_id
         LEFT JOIN user_emails selected_email ON selected_email.id = identity.email_id
         WHERE capacity.member_id = ?
           AND identity.started_at IS NOT NULL
           AND identity.ended_at IS NULL
           AND identity.blocked_at IS NULL
         ORDER BY u.first_name, u.last_name`,
        [member.memberId],
      ),
      resolveRepresentativeRoleHolders(db, member.memberId),
    ]);
    organizationIdentities = repRows.map((r) => ({
      identityId: r.identity_id,
      userId: r.user_id,
      name: identityDisplayName(r),
      email: r.email,
      showOnOrgProfile: r.show_on_org_profile === 1,
      isPrimaryContact: r.user_id === holders.primaryContactUserId,
      isSecondaryContact: r.user_id === holders.secondaryContactUserId,
    }));
    isOrgContact = member.userId === holders.primaryContactUserId || member.userId === holders.secondaryContactUserId;
  }

  return toProfile(row, member, emailAddresses, organizationIdentities, isOrgContact);
}

export interface MyProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  emailId?: string | null;
  jobTitle?: string;
  biography?: string;
  links?: string[];
  showOnOrgProfile?: boolean;
}

export async function updateMyProfile(
  db: DatabaseLike,
  member: AuthMember,
  input: MyProfileUpdateInput,
): Promise<MyProfile> {
  const now = nowIso();
  if (input.showOnOrgProfile !== undefined && !member.organizationId) {
    throw new AppError(422, "NO_ORGANIZATION", "This preference only applies to organization identities");
  }

  if (input.emailId !== undefined && !member.organizationId) {
    throw new AppError(422, "NO_ORGANIZATION", "An individual identity uses the account's primary email");
  }
  if (input.jobTitle !== undefined && !member.organizationId) {
    throw new AppError(
      422,
      "INDIVIDUAL_JOB_TITLE_FORBIDDEN",
      "Individual identity roles derive from membership category",
    );
  }

  const statements = [
    prepareAuthorizationGuard(db, memberSessionAuthorizationEvidence(member)),
    db
      .prepare(
        `UPDATE users
         SET first_name = COALESCE(?, first_name),
             last_name = COALESCE(?, last_name),
             preferred_name = COALESCE(?, preferred_name),
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.firstName ?? null, input.lastName ?? null, input.preferredName ?? null, now, member.userId),
  ];
  statements.push(
    db
      .prepare(
        `UPDATE identities
            SET email_id = CASE WHEN ? = 1 THEN ? ELSE email_id END,
                job_title = CASE WHEN ? = 1 THEN ? ELSE job_title END,
                biography = CASE WHEN ? = 1 THEN ? ELSE biography END,
                links_json = CASE WHEN ? = 1 THEN ? ELSE links_json END,
                show_on_organization_profile = CASE WHEN ? = 1 THEN ? ELSE show_on_organization_profile END,
                updated_at = ?
          WHERE id = ? AND user_id = ?
            AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
      )
      .bind(
        input.emailId !== undefined ? 1 : 0,
        input.emailId ?? null,
        member.organizationId && input.jobTitle !== undefined ? 1 : 0,
        input.jobTitle ?? null,
        input.biography !== undefined ? 1 : 0,
        input.biography ?? null,
        input.links !== undefined ? 1 : 0,
        input.links !== undefined ? serializeLinks(input.links) : null,
        member.organizationId && input.showOnOrgProfile !== undefined ? 1 : 0,
        input.showOnOrgProfile ? 1 : 0,
        now,
        member.identityId,
        member.userId,
      ),
  );
  statements.push(
    prepareAuditLogAfterOneChange(db, "member", member.userId, "user_profile_updated", "user", member.userId, {
      fields: Object.keys(input).sort(),
      memberId: member.memberId,
    }),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBERSHIP_CONTEXT_CHANGED",
        "The active membership changed before the profile was saved",
      );
    }
    if (error instanceof Error && error.message.includes("IDENTITY_EMAIL_INVALID")) {
      throw new AppError(422, "IDENTITY_EMAIL_INVALID", "Select a verified email address owned by this account");
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "PROFILE_CHANGED", "The profile changed before it was saved");
    }
    throw error;
  }

  return getMyProfile(db, member);
}

export interface MyApplicationSummary {
  id: string;
  stage: string;
  membershipCategory: string;
  createdAt: string;
}

export async function listMyApplications(
  db: DatabaseLike,
  member: AuthMember,
  params: MyApplicationsListQuery,
): Promise<{ applications: MyApplicationSummary[]; total: number }> {
  const search = params.q
    ? buildD1TextSearchFilter(params.q, ["membership_category", "stage", "organization_name"])
    : null;
  const where = search ? ` AND ${search.sql}` : "";
  const bindings = [member.memberId, member.userId, ...(search?.bindings ?? [])];
  const orderBy = resolveMappedOrderBy(
    params.sort,
    { createdAt: "created_at", stage: "stage" },
    "created_at DESC",
    "id ASC",
  );
  const result = await queryPage<{
    id: string;
    stage: string;
    membership_category: string;
    created_at: string;
  }>(db, {
    sql: `SELECT id, stage, membership_category, created_at
            FROM member_applications
            WHERE (member_id = ? OR (member_id IS NULL AND applicant_user_id = ?))${where}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return {
    applications: result.rows.map((row) => ({
      id: row.id,
      stage: row.stage,
      membershipCategory: row.membership_category,
      createdAt: row.created_at,
    })),
    total: result.total,
  };
}

export interface MyApplicationTimelineEntry {
  fromStage: string | null;
  toStage: string;
  note: string | null;
  createdAt: string;
}

export interface MyApplicationCommunicationEntry {
  subject: string | null;
  body: string;
  createdAt: string;
}

export interface MyApplicationDetail {
  id: string;
  applicantName: string;
  applicantEmail: string;
  organizationName: string | null;
  membershipCategory: string;
  stage: string;
  stageEnteredAt: string;
  createdAt: string;
  timeline: MyApplicationTimelineEntry[];
  communications: MyApplicationCommunicationEntry[];
}

/**
 * "My Application" tab: original application, status history, and
 * timeline. Scoped to the caller's own application(s) by matching
 * `member_id` against the selected Member capacity — current-user routes
 * never accept a target id that isn't independently ownership-checked
 * (see this file's header comment).
 */
export async function getMyApplicationDetail(
  db: DatabaseLike,
  member: AuthMember,
  applicationId: string,
): Promise<MyApplicationDetail> {
  const application = await getMemberApplicationById(db, applicationId);
  const ownedBySelectedCapacity = application?.member_id === member.memberId;
  const ownedByIdentityBeforeCapacityExists =
    application?.member_id === null && application.applicant_user_id === member.userId;
  if (!application || (!ownedBySelectedCapacity && !ownedByIdentityBeforeCapacityExists)) {
    throw new AppError(404, "NOT_FOUND", "Application not found");
  }

  const [events, communications] = await Promise.all([
    all<{ from_stage: string | null; to_stage: string; note: string | null; created_at: string }>(
      db,
      `SELECT from_stage, to_stage, note, created_at FROM member_application_events WHERE application_id = ? ORDER BY created_at ASC`,
      [applicationId],
    ),
    // kind = 'communication' only — 'note' rows are staff-internal (
    // application_communications.kind discriminator) and must never reach
    // the applicant.
    all<{ subject: string | null; body: string; created_at: string }>(
      db,
      `SELECT subject, body, created_at FROM application_communications WHERE application_id = ? AND kind = 'communication' ORDER BY created_at ASC`,
      [applicationId],
    ),
  ]);

  return {
    id: application.id,
    applicantName: application.applicant_name,
    applicantEmail: application.applicant_email,
    organizationName: application.organization_name,
    membershipCategory: application.membership_category,
    stage: application.stage,
    stageEnteredAt: application.stage_entered_at,
    createdAt: application.created_at,
    timeline: events.map((e) => ({
      fromStage: e.from_stage,
      toStage: e.to_stage,
      note: e.note,
      createdAt: e.created_at,
    })),
    communications: communications.map((c) => ({ subject: c.subject, body: c.body, createdAt: c.created_at })),
  };
}

// ── Notification preferences (Account Settings) ─────────

export interface MyNotificationPreferences {
  workingGroupUpdates: boolean;
  voteReminders: boolean;
  generalAnnouncements: boolean;
  // Weekly WG chair digest opt-out (2026-07-31 manual-testing feedback) —
  // see wg-chair-digest.ts, the only reader of this key outside this file.
  wgChairMembershipDigest: boolean;
}

// Opt-out model: every category defaults to on, matching
// opt-in-by-default precedent for showOnOrgProfile.
const DEFAULT_NOTIFICATION_PREFERENCES: MyNotificationPreferences = {
  workingGroupUpdates: true,
  voteReminders: true,
  generalAnnouncements: true,
  wgChairMembershipDigest: true,
};

/**
 * Keyed by an arbitrary userId rather than an AuthMember session — used by
 * wg-chair-digest.ts's scheduled job, which resolves recipients (WG chairs)
 * directly from user_roles rather than from an authenticated request.
 */
export async function getUserNotificationPreferences(
  db: DatabaseLike,
  userId: string,
): Promise<MyNotificationPreferences> {
  const row = await first<{ notification_preferences_json: string | null }>(
    db,
    "SELECT notification_preferences_json FROM users WHERE id = ?",
    [userId],
  );
  const stored = parseJsonSafe<Partial<MyNotificationPreferences>>(row?.notification_preferences_json ?? null, {});
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...stored };
}

export async function getMyNotificationPreferences(
  db: DatabaseLike,
  member: AuthMember,
): Promise<MyNotificationPreferences> {
  return getUserNotificationPreferences(db, member.userId);
}

export async function updateMyNotificationPreferences(
  db: DatabaseLike,
  member: AuthMember,
  input: Partial<MyNotificationPreferences>,
): Promise<MyNotificationPreferences> {
  const row = await first<{ notification_preferences_json: string | null }>(
    db,
    "SELECT notification_preferences_json FROM users WHERE id = ?",
    [member.userId],
  );
  const current = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...parseJsonSafe<Partial<MyNotificationPreferences>>(row?.notification_preferences_json ?? null, {}),
  };
  const next = { ...current, ...input };
  const at = nowIso();
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE users
              SET notification_preferences_json = ?, updated_at = ?
            WHERE id = ? AND notification_preferences_json IS ?`,
        )
        .bind(stringifyJson(next), at, member.userId, row?.notification_preferences_json ?? null),
      prepareAuditLogAfterOneChange(
        db,
        "member",
        member.userId,
        "notification_preferences_updated",
        "user",
        member.userId,
        { fields: Object.keys(input).sort(), memberId: member.memberId },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "NOTIFICATION_PREFERENCES_CHANGED", "Notification preferences changed concurrently");
    }
    throw error;
  }
  return next;
}

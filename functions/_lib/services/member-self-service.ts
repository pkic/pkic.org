/**
 * Member profile, applications, and notification self-service. All
 * functions here operate on the caller's own AuthMember identity —
 * `/api/v1/me/*` never accepts a target user/member id, by design.
 */
import { all, first, run } from "../db/queries";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { nowIso } from "../utils/time";
import { stringifyJson, parseJsonSafe } from "../utils/json";
import { parseLinksJson, serializeLinks } from "../../../assets/shared/schemas/links";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { VOTING_CATEGORIES } from "./membership/applications/create";
import { getMemberApplicationById } from "./membership/applications/queries";
import { resolveRepresentativeRoleHolders } from "./membership/representative-roles";
import type { AuthMember, DatabaseLike, EligibleMembership } from "../types";

export interface MyOrganizationRepresentative {
  userId: string;
  name: string | null;
  email: string;
  isPrimaryContact: boolean;
  isSecondaryContact: boolean;
}

export interface MyProfile {
  userId: string;
  email: string;
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
  canEditOrganizationName: boolean;
  /** True when this member is their organization's primary or secondary contact. */
  isOrgContact: boolean;
  /** Full representative roster for the caller's organization; null when org-less. */
  organizationRepresentatives: MyOrganizationRepresentative[] | null;
  /**
   * Every membership context this member is currently eligible to act
   * through (see AuthMember.activeMemberships) — lets a person who
   * represents more than one organization see, and switch, which one is
   * currently active via PUT /api/v1/me/active-membership.
   */
  activeMemberships: EligibleMembership[];
}

interface MyProfileRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  organization_name: string | null;
  category_code: string;
  organization_id: string | null;
  show_on_org_profile: number;
  headshot_r2_key: string | null;
  member_since: string | null;
  member_created_at: string;
  org_name: string | null;
}

interface OrganizationRepresentativeRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string;
}

function representativeDisplayName(row: OrganizationRepresentativeRow): string | null {
  if (row.preferred_name) return row.preferred_name;
  const full = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return full || null;
}

function toProfile(
  row: MyProfileRow,
  member: AuthMember,
  organizationRepresentatives: MyOrganizationRepresentative[] | null,
  isOrgContact: boolean,
): MyProfile {
  const isIndividual = row.organization_id === null;
  return {
    userId: member.userId,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    preferredName: row.preferred_name,
    jobTitle: row.job_title,
    biography: row.biography,
    links: parseLinksJson(row.links_json),
    membershipCategory: row.category_code,
    organizationId: row.organization_id,
    organizationName: row.org_name ?? row.organization_name,
    memberSince: row.member_since ?? row.member_created_at,
    showOnOrgProfile: row.show_on_org_profile === 1,
    // Public capability-URL path (functions/api/v1/headshots/:userId/:file) —
    // matches admin/users/[userId]/index.ts's identical construction.
    headshotUrl: row.headshot_r2_key ? `/api/v1/${row.headshot_r2_key}` : null,
    // organization is locked to membership for org-tied categories;
    // H5/H6/H7 (org-less) may set a free-text organization name.
    canEditOrganizationName: isIndividual,
    isOrgContact,
    organizationRepresentatives,
    activeMemberships: member.activeMemberships,
  };
}

export async function getMyProfile(db: DatabaseLike, member: AuthMember): Promise<MyProfile> {
  const row = await first<MyProfileRow>(
    db,
    `SELECT u.email, u.first_name, u.last_name, u.preferred_name, u.job_title, u.biography, u.links_json,
            u.organization_name, u.headshot_r2_key, mca.category_code, m.organization_id,
            COALESCE(r.show_on_org_profile, 1) AS show_on_org_profile,
            m.member_since, m.created_at AS member_created_at, o.name AS org_name
     FROM users u
     JOIN members m ON m.id = ?
     JOIN member_category_assignments mca ON mca.member_id = m.id
     LEFT JOIN organizations o ON o.id = m.organization_id
     LEFT JOIN organization_representatives r ON r.member_id = m.id AND r.user_id = u.id AND r.left_at IS NULL
     WHERE u.id = ?`,
    [member.memberId, member.userId],
  );
  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Profile not found");
  }

  let organizationRepresentatives: MyOrganizationRepresentative[] | null = null;
  let isOrgContact = false;
  if (row.organization_id) {
    const [repRows, holders] = await Promise.all([
      all<OrganizationRepresentativeRow>(
        db,
        `SELECT u.id AS user_id, u.first_name, u.last_name, u.preferred_name, u.email
         FROM organization_representatives r
         JOIN users u ON u.id = r.user_id
         WHERE r.member_id = ? AND r.left_at IS NULL
         ORDER BY u.first_name, u.last_name`,
        [member.memberId],
      ),
      resolveRepresentativeRoleHolders(db, member.memberId),
    ]);
    organizationRepresentatives = repRows.map((r) => ({
      userId: r.user_id,
      name: representativeDisplayName(r),
      email: r.email,
      isPrimaryContact: r.user_id === holders.primaryContactUserId,
      isSecondaryContact: r.user_id === holders.secondaryContactUserId,
    }));
    isOrgContact = member.userId === holders.primaryContactUserId || member.userId === holders.secondaryContactUserId;
  }

  return toProfile(row, member, organizationRepresentatives, isOrgContact);
}

export interface MyProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  jobTitle?: string;
  biography?: string;
  links?: string[];
  /** Only honored for org-less categories (H5/H6/H7). */
  organizationName?: string;
}

export async function updateMyProfile(
  db: DatabaseLike,
  member: AuthMember,
  input: MyProfileUpdateInput,
): Promise<MyProfile> {
  const now = nowIso();

  await run(
    db,
    `UPDATE users
     SET first_name = COALESCE(?, first_name),
         last_name = COALESCE(?, last_name),
         preferred_name = COALESCE(?, preferred_name),
         job_title = COALESCE(?, job_title),
         biography = COALESCE(?, biography),
         links_json = COALESCE(?, links_json),
         updated_at = ?
     WHERE id = ?`,
    [
      input.firstName ?? null,
      input.lastName ?? null,
      input.preferredName ?? null,
      input.jobTitle ?? null,
      input.biography ?? null,
      input.links ? serializeLinks(input.links) : null,
      now,
      member.userId,
    ],
  );

  // organization is locked to membership for org-tied categories —
  // only H5/H6/H7 (member.organizationId === null) may set a free-text name.
  if (member.organizationId === null && input.organizationName !== undefined) {
    await run(db, `UPDATE users SET organization_name = ?, updated_at = ? WHERE id = ?`, [
      input.organizationName,
      now,
      member.userId,
    ]);
  }

  return getMyProfile(db, member);
}

export async function updateOrganizationVisibility(
  db: DatabaseLike,
  member: AuthMember,
  showOnOrgProfile: boolean,
): Promise<void> {
  if (!member.organizationId) {
    throw new AppError(422, "NO_ORGANIZATION", "This preference only applies to organization representatives");
  }
  await run(
    db,
    `UPDATE organization_representatives SET show_on_org_profile = ?, updated_at = ?
     WHERE member_id = ? AND user_id = ? AND left_at IS NULL`,
    [showOnOrgProfile ? 1 : 0, nowIso(), member.memberId, member.userId],
  );
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
  params: { q?: string; sort?: string; limit: number; offset: number },
): Promise<{ applications: MyApplicationSummary[]; total: number }> {
  const search = params.q
    ? buildD1TextSearchFilter(params.q, ["membership_category", "stage", "organization_name"])
    : null;
  const where = search ? ` AND ${search.sql}` : "";
  const bindings = [member.email, ...(search?.bindings ?? [])];
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
  }>(
    db,
    {
      sql: `SELECT id, stage, membership_category, created_at
            FROM member_applications
            WHERE applicant_email = ?${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...bindings, params.limit, params.offset],
    },
    {
      sql: `SELECT COUNT(*) AS total FROM member_applications WHERE applicant_email = ?${where}`,
      bindings,
    },
  );
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
 * `applicant_email` against the member session's email — `/api/v1/me/*`
 * never accepts a target id that isn't independently ownership-checked
 * (see this file's header comment).
 */
export async function getMyApplicationDetail(
  db: DatabaseLike,
  member: AuthMember,
  applicationId: string,
): Promise<MyApplicationDetail> {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application || normalizeEmail(application.applicant_email) !== normalizeEmail(member.email)) {
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

// ── Working group self-service ────────────────────────────────────

/** True for A-G members — used by /api/v1/me/votes (currently a stub, see route) to at least gate on category shape. */
export function isVotingCategory(category: string): boolean {
  return VOTING_CATEGORIES.has(category);
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
  const current = await getMyNotificationPreferences(db, member);
  const next = { ...current, ...input };
  await run(db, "UPDATE users SET notification_preferences_json = ?, updated_at = ? WHERE id = ?", [
    stringifyJson(next),
    nowIso(),
    member.userId,
  ]);
  return next;
}

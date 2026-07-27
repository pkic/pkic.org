/**
 * Admin Organizations management — post-approval organization profile
 * (§4.11's data-bearing columns, pulled forward by migration 0037) plus
 * its representative roster (the `members` rows tying `users` to this
 * `organization_id`, established by migration 0033).
 *
 * This is the "manage an organization once it's approved" surface the
 * §6 Interim Admin Tool didn't provide — that tool only ever created new
 * org+member rows, with no way to edit a profile or roster afterward.
 */
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { findOrCreateUser } from "./users";
import { normalizeOrgName } from "./sponsorship";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

function logoUrlFor(id: string, logoR2Key: string | null): string | null {
  return logoR2Key ? `/api/v1/members/${id}/logo` : null;
}

// ── List ─────────────────────────────────────────────────────────────────

interface OrgSummaryRow {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  slogan: string | null;
  logo_r2_key: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
  primary_contact_first_name: string | null;
  primary_contact_last_name: string | null;
  primary_contact_email: string | null;
}

const ORG_SUMMARY_SELECT = `
  SELECT o.id, o.name, o.website, o.description, o.slogan, o.logo_r2_key, o.created_at, o.updated_at,
         (SELECT COUNT(*) FROM members m WHERE m.organization_id = o.id) AS member_count,
         pu.first_name AS primary_contact_first_name, pu.last_name AS primary_contact_last_name,
         pu.email AS primary_contact_email
  FROM organizations o
  LEFT JOIN users pu ON pu.id = o.primary_contact_user_id
`;

function toOrgSummary(row: OrgSummaryRow) {
  const primaryContactName = [row.primary_contact_first_name, row.primary_contact_last_name].filter(Boolean).join(" ");
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    description: row.description,
    slogan: row.slogan,
    logoUrl: logoUrlFor(row.id, row.logo_r2_key),
    memberCount: row.member_count,
    primaryContactName: primaryContactName || null,
    primaryContactEmail: row.primary_contact_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAdminOrganizations(
  db: DatabaseLike,
  params: { limit: number; offset: number; q?: string },
): Promise<{ organizations: ReturnType<typeof toOrgSummary>[]; total: number }> {
  const where = params.q ? "WHERE o.name LIKE ?" : "";
  const whereArgs = params.q ? [`%${params.q}%`] : [];

  const [rows, totalRow] = await Promise.all([
    all<OrgSummaryRow>(db, `${ORG_SUMMARY_SELECT} ${where} ORDER BY o.name ASC LIMIT ? OFFSET ?`, [
      ...whereArgs,
      params.limit,
      params.offset,
    ]),
    first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM organizations o ${where}`, whereArgs),
  ]);

  return { organizations: rows.map(toOrgSummary), total: totalRow?.total ?? 0 };
}

// ── Detail ───────────────────────────────────────────────────────────────

interface OrgDetailRow extends OrgSummaryRow {
  content_markdown: string | null;
  blog_url: string | null;
  blog_feed_url: string | null;
  press_url: string | null;
  press_feed_url: string | null;
  careers_url: string | null;
  social_x: string | null;
  social_linkedin: string | null;
  social_facebook: string | null;
  social_instagram: string | null;
  social_youtube: string | null;
  primary_contact_user_id: string | null;
  secondary_contact_user_id: string | null;
}

interface RepresentativeRow {
  member_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  job_title: string | null;
  member_type: string;
  status: string;
  show_on_org_profile: number;
  created_at: string;
}

async function fetchOrgDetailRow(db: DatabaseLike, id: string): Promise<OrgDetailRow | null> {
  return first<OrgDetailRow>(
    db,
    `SELECT o.id, o.name, o.website, o.description, o.slogan, o.logo_r2_key, o.created_at, o.updated_at,
            o.content_markdown, o.blog_url, o.blog_feed_url, o.press_url, o.press_feed_url, o.careers_url,
            o.social_x, o.social_linkedin, o.social_facebook, o.social_instagram, o.social_youtube,
            o.primary_contact_user_id, o.secondary_contact_user_id,
            (SELECT COUNT(*) FROM members m WHERE m.organization_id = o.id) AS member_count,
            pu.first_name AS primary_contact_first_name, pu.last_name AS primary_contact_last_name,
            pu.email AS primary_contact_email
     FROM organizations o
     LEFT JOIN users pu ON pu.id = o.primary_contact_user_id
     WHERE o.id = ?`,
    [id],
  );
}

async function fetchRepresentatives(db: DatabaseLike, organizationId: string): Promise<RepresentativeRow[]> {
  return all<RepresentativeRow>(
    db,
    `SELECT m.id AS member_id, m.user_id, u.first_name, u.last_name, u.email, u.job_title,
            m.member_type, m.status, m.show_on_org_profile, m.created_at
     FROM members m
     JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = ?
     ORDER BY m.created_at ASC`,
    [organizationId],
  );
}

function toOrgDetail(row: OrgDetailRow, representatives: RepresentativeRow[]) {
  return {
    ...toOrgSummary(row),
    contentMarkdown: row.content_markdown,
    blogUrl: row.blog_url,
    blogFeedUrl: row.blog_feed_url,
    pressUrl: row.press_url,
    pressFeedUrl: row.press_feed_url,
    careersUrl: row.careers_url,
    socialX: row.social_x,
    socialLinkedin: row.social_linkedin,
    socialFacebook: row.social_facebook,
    socialInstagram: row.social_instagram,
    socialYoutube: row.social_youtube,
    primaryContactUserId: row.primary_contact_user_id,
    secondaryContactUserId: row.secondary_contact_user_id,
    representatives: representatives.map((r) => ({
      memberId: r.member_id,
      userId: r.user_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email,
      email: r.email,
      jobTitle: r.job_title,
      membershipCategory: r.member_type,
      status: r.status,
      showOnOrgProfile: r.show_on_org_profile === 1,
      isPrimaryContact: r.user_id === row.primary_contact_user_id,
      isSecondaryContact: r.user_id === row.secondary_contact_user_id,
      createdAt: r.created_at,
    })),
  };
}

export async function getAdminOrganization(db: DatabaseLike, id: string) {
  const row = await fetchOrgDetailRow(db, id);
  if (!row) throw new AppError(404, "NOT_FOUND", "Organization not found");
  const representatives = await fetchRepresentatives(db, id);
  return toOrgDetail(row, representatives);
}

// ── Update profile ───────────────────────────────────────────────────────

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: "name",
  description: "description",
  website: "website",
  contentMarkdown: "content_markdown",
  slogan: "slogan",
  blogUrl: "blog_url",
  blogFeedUrl: "blog_feed_url",
  pressUrl: "press_url",
  pressFeedUrl: "press_feed_url",
  careersUrl: "careers_url",
  socialX: "social_x",
  socialLinkedin: "social_linkedin",
  socialFacebook: "social_facebook",
  socialInstagram: "social_instagram",
  socialYoutube: "social_youtube",
};

export interface OrganizationUpdateInput {
  name?: string;
  description?: string | null;
  website?: string | null;
  contentMarkdown?: string | null;
  slogan?: string | null;
  blogUrl?: string | null;
  blogFeedUrl?: string | null;
  pressUrl?: string | null;
  pressFeedUrl?: string | null;
  careersUrl?: string | null;
  socialX?: string | null;
  socialLinkedin?: string | null;
  socialFacebook?: string | null;
  socialInstagram?: string | null;
  socialYoutube?: string | null;
  primaryContactUserId?: string | null;
  secondaryContactUserId?: string | null;
}

export async function updateAdminOrganization(db: DatabaseLike, id: string, input: OrganizationUpdateInput) {
  const existing = await fetchOrgDetailRow(db, id);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Organization not found");

  if (input.name !== undefined && normalizeOrgName(input.name) !== normalizeOrgName(existing.name)) {
    const conflict = await first<{ id: string }>(
      db,
      "SELECT id FROM organizations WHERE normalized_name = ? AND id != ?",
      [normalizeOrgName(input.name), id],
    );
    if (conflict) throw new AppError(409, "DUPLICATE", "Another organization already uses that name");
  }

  for (const [field, userId] of [
    ["primaryContactUserId", input.primaryContactUserId],
    ["secondaryContactUserId", input.secondaryContactUserId],
  ] as const) {
    if (!userId) continue;
    const isRepresentative = await first<{ id: string }>(
      db,
      "SELECT id FROM members WHERE organization_id = ? AND user_id = ?",
      [id, userId],
    );
    if (!isRepresentative) {
      throw new AppError(
        422,
        "NOT_A_REPRESENTATIVE",
        `${field} must be an existing representative of this organization`,
      );
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    setClauses.push(`${column} = ?`);
    values.push(value);
  }
  if (key_in(input, "name")) {
    setClauses.push("normalized_name = ?");
    values.push(normalizeOrgName(input.name as string));
  }
  if (input.primaryContactUserId !== undefined) {
    setClauses.push("primary_contact_user_id = ?");
    values.push(input.primaryContactUserId);
  }
  if (input.secondaryContactUserId !== undefined) {
    setClauses.push("secondary_contact_user_id = ?");
    values.push(input.secondaryContactUserId);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso());
    values.push(id);
    await run(db, `UPDATE organizations SET ${setClauses.join(", ")} WHERE id = ?`, values);
  }

  return getAdminOrganization(db, id);
}

function key_in<T extends object>(obj: T, key: keyof T): boolean {
  return obj[key] !== undefined;
}

// ── Representatives ──────────────────────────────────────────────────────

export interface AddRepresentativeInput {
  name: string;
  email: string;
  jobTitle?: string;
  linkedin?: string;
  membershipCategory: string;
}

export async function addOrganizationRepresentative(
  db: DatabaseLike,
  organizationId: string,
  input: AddRepresentativeInput,
) {
  const org = await first<{
    id: string;
    primary_contact_user_id: string | null;
    secondary_contact_user_id: string | null;
  }>(db, "SELECT id, primary_contact_user_id, secondary_contact_user_id FROM organizations WHERE id = ?", [
    organizationId,
  ]);
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const existingUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [
    input.email.trim().toLowerCase(),
  ]);
  if (existingUser) {
    const existingMember = await first<{ id: string }>(db, "SELECT id FROM members WHERE user_id = ?", [
      existingUser.id,
    ]);
    if (existingMember) {
      throw new AppError(409, "ALREADY_MEMBER", `${input.email} already holds a membership`);
    }
  }

  // For an existing user, leave their name as already recorded rather than
  // re-deriving it from a single `name` string — round-tripping an existing
  // "first_name"/"last_name" pair through join-then-splitName is lossy for
  // multi-word surnames (e.g. "Albert" / "de Ruiter" becomes "Albert de" /
  // "Ruiter"), which matters here because callers like the Users "Grant
  // membership" flow build `input.name` by joining the user's own existing
  // names.
  const { firstName, lastName } = existingUser ? { firstName: undefined, lastName: undefined } : splitName(input.name);
  const user = await findOrCreateUser(db, {
    email: input.email,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
    jobTitle: input.jobTitle,
    linksJson: input.linkedin ? JSON.stringify({ linkedin: input.linkedin }) : null,
    allowProfileUpdate: true,
  });

  const now = nowIso();
  const memberId = uuid();
  await run(
    db,
    `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at, show_on_org_profile)
     VALUES (?, ?, ?, ?, 'active', NULL, NULL, ?, ?, 1)`,
    [memberId, input.membershipCategory, user.id, organizationId, now, now],
  );

  if (!org.primary_contact_user_id) {
    await run(db, "UPDATE organizations SET primary_contact_user_id = ?, updated_at = ? WHERE id = ?", [
      user.id,
      now,
      organizationId,
    ]);
  } else if (!org.secondary_contact_user_id) {
    await run(db, "UPDATE organizations SET secondary_contact_user_id = ?, updated_at = ? WHERE id = ?", [
      user.id,
      now,
      organizationId,
    ]);
  }

  return {
    memberId,
    userId: user.id,
    name: input.name,
    email: user.email,
    jobTitle: input.jobTitle ?? null,
    membershipCategory: input.membershipCategory,
    status: "active",
    showOnOrgProfile: true,
    isPrimaryContact: !org.primary_contact_user_id,
    isSecondaryContact: Boolean(org.primary_contact_user_id) && !org.secondary_contact_user_id,
    createdAt: now,
  };
}

// ── Single-member edit/remove ───────────────────────────────────────────

export interface MemberUpdateInput {
  membershipCategory?: string;
  status?: string;
  showOnOrgProfile?: boolean;
}

interface MemberRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  member_type: string;
  status: string;
  show_on_org_profile: number;
}

export async function updateAdminMember(db: DatabaseLike, memberId: string, input: MemberUpdateInput) {
  const member = await first<MemberRow>(
    db,
    "SELECT id, user_id, organization_id, member_type, status, show_on_org_profile FROM members WHERE id = ?",
    [memberId],
  );
  if (!member) throw new AppError(404, "NOT_FOUND", "Member not found");

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (input.membershipCategory !== undefined) {
    setClauses.push("member_type = ?");
    values.push(input.membershipCategory);
  }
  if (input.status !== undefined) {
    setClauses.push("status = ?");
    values.push(input.status);
  }
  if (input.showOnOrgProfile !== undefined) {
    setClauses.push("show_on_org_profile = ?");
    values.push(input.showOnOrgProfile ? 1 : 0);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso());
    values.push(memberId);
    await run(db, `UPDATE members SET ${setClauses.join(", ")} WHERE id = ?`, values);
  }

  return {
    id: memberId,
    userId: member.user_id,
    organizationId: member.organization_id,
    membershipCategory: input.membershipCategory ?? member.member_type,
    status: input.status ?? member.status,
    showOnOrgProfile: input.showOnOrgProfile ?? member.show_on_org_profile === 1,
  };
}

/**
 * Grants an org-less individual membership (H5/H6/H7) to an existing user,
 * from the Users detail view — the counterpart to
 * `addOrganizationRepresentative` for people with no organization.
 */
export async function grantIndividualMembership(db: DatabaseLike, userId: string, membershipCategory: string) {
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [userId]);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const existingMember = await first<{ id: string }>(db, "SELECT id FROM members WHERE user_id = ?", [userId]);
  if (existingMember) throw new AppError(409, "ALREADY_MEMBER", "This user already holds a membership");

  const now = nowIso();
  const memberId = uuid();
  await run(
    db,
    `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at, show_on_org_profile)
     VALUES (?, ?, ?, NULL, 'active', NULL, NULL, ?, ?, 1)`,
    [memberId, membershipCategory, userId, now, now],
  );

  return {
    id: memberId,
    userId,
    organizationId: null,
    membershipCategory,
    status: "active",
    showOnOrgProfile: true,
    createdAt: now,
  };
}

export async function removeAdminMember(db: DatabaseLike, memberId: string): Promise<MemberRow> {
  const member = await first<MemberRow>(
    db,
    "SELECT id, user_id, organization_id, member_type, status, show_on_org_profile FROM members WHERE id = ?",
    [memberId],
  );
  if (!member) throw new AppError(404, "NOT_FOUND", "Member not found");

  await run(db, "DELETE FROM members WHERE id = ?", [memberId]);

  if (member.organization_id) {
    const now = nowIso();
    await run(
      db,
      "UPDATE organizations SET primary_contact_user_id = NULL, updated_at = ? WHERE id = ? AND primary_contact_user_id = ?",
      [now, member.organization_id, member.user_id],
    );
    await run(
      db,
      "UPDATE organizations SET secondary_contact_user_id = NULL, updated_at = ? WHERE id = ? AND secondary_contact_user_id = ?",
      [now, member.organization_id, member.user_id],
    );
  }

  return member;
}

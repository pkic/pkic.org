/**
 * Admin Organizations management — post-approval organization profile
 * (data-bearing columns, pulled forward by migration 0040) plus its
 * representative roster (`organization_representatives`, migration 0037).
 *
 * This is the "manage an organization once it's approved" surface the
 * Interim Admin Tool didn't provide — that tool only ever created new
 * org+member rows, with no way to edit a profile or roster afterward.
 */
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import { resolveOrderBy } from "../db/sort";
import { findOrCreateUser } from "./users";
import { normalizeOrgName } from "./sponsorship";
import { serializeLinks, parseLinksJson } from "../../../assets/shared/schemas/api";
import {
  getOrCreateOrganizationMemberAggregate,
  buildCreateIndividualMemberStatements,
} from "./membership/memberships";
import {
  isActiveRepresentative,
  buildAddRepresentativeStatement,
  buildCloseRepresentativeStatement,
} from "./membership/representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  resolveRepresentativeRoleHolders,
  buildAssignRepresentativeRoleStatements,
  buildRevokeRepresentativeRoleStatement,
} from "./membership/representative-roles";
import type { DatabaseLike, StatementLike } from "../types";

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

function logoUrlFor(id: string, logoR2Key: string | null): string | null {
  return logoR2Key ? `/api/v1/members/${id}/logo` : null;
}

async function getOrgAggregate(
  db: DatabaseLike,
  organizationId: string,
): Promise<{ id: string; categoryCode: string | null } | null> {
  return first<{ id: string; categoryCode: string | null }>(
    db,
    `SELECT m.id AS id, mca.category_code AS categoryCode
     FROM members m LEFT JOIN member_category_assignments mca ON mca.member_id = m.id
     WHERE m.organization_id = ?`,
    [organizationId],
  );
}

// ── List ─────────────────────────────────────────────────────────────────

interface OrgSummaryRow {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  slogan: string | null;
  logo_r2_key: string | null;
  member_since: string | null;
  membership_category: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
  primary_contact_first_name: string | null;
  primary_contact_last_name: string | null;
  primary_contact_email: string | null;
}

const ORG_SUMMARY_SELECT = `
  SELECT o.id, o.name, o.website, o.description, o.slogan, o.logo_r2_key, m.member_since, o.created_at, o.updated_at,
         mca.category_code AS membership_category,
         (SELECT COUNT(*) FROM organization_representatives r
           JOIN members m2 ON m2.id = r.member_id WHERE m2.organization_id = o.id AND r.left_at IS NULL) AS member_count,
         pu.first_name AS primary_contact_first_name, pu.last_name AS primary_contact_last_name,
         pu.email AS primary_contact_email
  FROM organizations o
  LEFT JOIN members m ON m.organization_id = o.id
  LEFT JOIN member_category_assignments mca ON mca.member_id = m.id
  LEFT JOIN user_roles pr ON pr.context_type = 'organization' AND pr.context_id = m.id
    AND pr.role_id = '${REPRESENTATIVE_ROLE_IDS.primaryContact}' AND pr.revoked_at IS NULL
  LEFT JOIN users pu ON pu.id = pr.user_id
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
    membershipCategory: row.membership_category,
    // Falls back to the row's own creation time for organizations created
    // before migration 0049 added this column (or via a path that never set
    // it) — matches the same fallback members-directory.ts/member-self-service.ts use.
    memberSince: row.member_since ?? row.created_at,
    memberCount: row.member_count,
    primaryContactName: primaryContactName || null,
    primaryContactEmail: row.primary_contact_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Unqualified column/alias names, matching what ORG_SUMMARY_SELECT's result
// set actually labels them as (SQLite allows ORDER BY on a SELECT-list
// alias) — unambiguous here since none of these names collide with a
// joined `users` column.
const ORG_SORT_COLUMNS = ["name", "membership_category", "created_at", "member_count"] as const;

export async function listAdminOrganizations(
  db: DatabaseLike,
  params: { limit: number; offset: number; q?: string; sort?: string },
): Promise<{ organizations: ReturnType<typeof toOrgSummary>[]; total: number }> {
  const where = params.q ? "WHERE o.name LIKE ?" : "";
  const whereArgs = params.q ? [`%${params.q}%`] : [];
  const orderBy = resolveOrderBy(params.sort, ORG_SORT_COLUMNS, "ORDER BY o.name ASC");

  const [rows, totalRow] = await Promise.all([
    all<OrgSummaryRow>(db, `${ORG_SUMMARY_SELECT} ${where} ${orderBy} LIMIT ? OFFSET ?`, [
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
  links_json: string | null;
}

interface RepresentativeRow {
  representative_id: string;
  member_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  job_title: string | null;
  show_on_org_profile: number;
  created_at: string;
}

async function fetchOrgDetailRow(db: DatabaseLike, id: string): Promise<OrgDetailRow | null> {
  return first<OrgDetailRow>(
    db,
    `SELECT o.id, o.name, o.website, o.description, o.slogan, o.logo_r2_key, m.member_since, o.created_at, o.updated_at,
            mca.category_code AS membership_category,
            o.content_markdown, o.blog_url, o.blog_feed_url, o.press_url, o.press_feed_url, o.careers_url,
            o.links_json,
            (SELECT COUNT(*) FROM organization_representatives r
              JOIN members m2 ON m2.id = r.member_id WHERE m2.organization_id = o.id AND r.left_at IS NULL) AS member_count,
            pu.first_name AS primary_contact_first_name, pu.last_name AS primary_contact_last_name,
            pu.email AS primary_contact_email
     FROM organizations o
     LEFT JOIN members m ON m.organization_id = o.id
     LEFT JOIN member_category_assignments mca ON mca.member_id = m.id
     LEFT JOIN user_roles pr ON pr.context_type = 'organization' AND pr.context_id = m.id
       AND pr.role_id = '${REPRESENTATIVE_ROLE_IDS.primaryContact}' AND pr.revoked_at IS NULL
     LEFT JOIN users pu ON pu.id = pr.user_id
     WHERE o.id = ?`,
    [id],
  );
}

async function fetchRepresentatives(db: DatabaseLike, organizationId: string): Promise<RepresentativeRow[]> {
  return all<RepresentativeRow>(
    db,
    `SELECT r.id AS representative_id, r.member_id, r.user_id, u.first_name, u.last_name, u.email, u.job_title,
            r.show_on_org_profile, r.created_at
     FROM organization_representatives r
     JOIN members m ON m.id = r.member_id
     JOIN users u ON u.id = r.user_id
     WHERE m.organization_id = ? AND r.left_at IS NULL
     ORDER BY r.created_at ASC`,
    [organizationId],
  );
}

async function toOrgDetail(
  db: DatabaseLike,
  row: OrgDetailRow,
  representatives: RepresentativeRow[],
  memberId: string | null,
) {
  const holders = memberId
    ? await resolveRepresentativeRoleHolders(db, memberId)
    : { primaryContactUserId: null, secondaryContactUserId: null, votingDelegateUserId: null };
  return {
    ...toOrgSummary(row),
    contentMarkdown: row.content_markdown,
    blogUrl: row.blog_url,
    blogFeedUrl: row.blog_feed_url,
    pressUrl: row.press_url,
    pressFeedUrl: row.press_feed_url,
    careersUrl: row.careers_url,
    links: parseLinksJson(row.links_json),
    primaryContactUserId: holders.primaryContactUserId,
    secondaryContactUserId: holders.secondaryContactUserId,
    votingDelegateUserId: holders.votingDelegateUserId,
    representatives: representatives.map((r) => ({
      // memberId here is the representative's own organization_representatives.id
      // — the identifier PATCH/DELETE /api/v1/admin/members/:id expects — not
      // the shared aggregate members.id (every representative of this
      // organization shares one aggregate row).
      memberId: r.representative_id,
      userId: r.user_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email,
      email: r.email,
      jobTitle: r.job_title,
      status: "active",
      showOnOrgProfile: r.show_on_org_profile === 1,
      isPrimaryContact: r.user_id === holders.primaryContactUserId,
      isSecondaryContact: r.user_id === holders.secondaryContactUserId,
      createdAt: r.created_at,
    })),
  };
}

export async function getAdminOrganization(db: DatabaseLike, id: string) {
  const row = await fetchOrgDetailRow(db, id);
  if (!row) throw new AppError(404, "NOT_FOUND", "Organization not found");
  const [representatives, aggregate] = await Promise.all([fetchRepresentatives(db, id), getOrgAggregate(db, id)]);
  return toOrgDetail(db, row, representatives, aggregate?.id ?? null);
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
};

export interface OrganizationUpdateInput {
  name?: string;
  membershipCategory?: string;
  memberSince?: string | null;
  description?: string | null;
  website?: string | null;
  contentMarkdown?: string | null;
  slogan?: string | null;
  blogUrl?: string | null;
  blogFeedUrl?: string | null;
  pressUrl?: string | null;
  pressFeedUrl?: string | null;
  careersUrl?: string | null;
  links?: string[];
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

  let aggregateId: string | null;
  if (input.membershipCategory !== undefined) {
    // Explicit staff-driven change, not the create-time race — always
    // apply the requested category rather than routing through
    // getOrCreateOrganizationMemberAggregate, which is a get-or-CREATE
    // primitive that rejects a differing category as a conflict (that
    // conflict guard exists for concurrent first-time creation, not for
    // an admin legitimately changing an already-assigned category here).
    const existingAggregate = await getOrgAggregate(db, id);
    if (existingAggregate) {
      aggregateId = existingAggregate.id;
      await run(db, "UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE member_id = ?", [
        input.membershipCategory,
        nowIso(),
        aggregateId,
      ]);
    } else {
      const aggregate = await getOrCreateOrganizationMemberAggregate(db, id, input.membershipCategory);
      aggregateId = aggregate.id;
    }
  } else {
    const aggregate = await getOrgAggregate(db, id);
    aggregateId = aggregate?.id ?? null;
  }

  for (const [field, userId] of [
    ["primaryContactUserId", input.primaryContactUserId],
    ["secondaryContactUserId", input.secondaryContactUserId],
  ] as const) {
    if (!userId || !aggregateId) continue;
    const isRepresentative = await isActiveRepresentative(db, aggregateId, userId);
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
  if (input.name !== undefined) {
    setClauses.push("normalized_name = ?");
    values.push(normalizeOrgName(input.name));
  }
  if (input.links !== undefined) {
    setClauses.push("links_json = ?");
    values.push(serializeLinks(input.links));
  }

  const statements: StatementLike[] = [];
  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso());
    values.push(id);
    statements.push(db.prepare(`UPDATE organizations SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values));
  }

  const now = nowIso();
  if (aggregateId && input.memberSince !== undefined) {
    statements.push(
      db
        .prepare("UPDATE members SET member_since = ?, updated_at = ? WHERE id = ?")
        .bind(input.memberSince, now, aggregateId),
    );
  }
  if (aggregateId && input.primaryContactUserId !== undefined) {
    if (input.primaryContactUserId) {
      statements.push(
        ...(await buildAssignRepresentativeRoleStatements(db, {
          memberId: aggregateId,
          userId: input.primaryContactUserId,
          roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
          now,
        })),
      );
    } else {
      statements.push(
        buildRevokeRepresentativeRoleStatement(db, {
          memberId: aggregateId,
          roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
          now,
        }),
      );
    }
  }
  if (aggregateId && input.secondaryContactUserId !== undefined) {
    if (input.secondaryContactUserId) {
      statements.push(
        ...(await buildAssignRepresentativeRoleStatements(db, {
          memberId: aggregateId,
          userId: input.secondaryContactUserId,
          roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
          now,
        })),
      );
    } else {
      statements.push(
        buildRevokeRepresentativeRoleStatement(db, {
          memberId: aggregateId,
          roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
          now,
        }),
      );
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return getAdminOrganization(db, id);
}

// ── Representatives ──────────────────────────────────────────────────────

export interface AddRepresentativeInput {
  name: string;
  email: string;
  jobTitle?: string;
  linkedin?: string;
}

export async function addOrganizationRepresentative(
  db: DatabaseLike,
  organizationId: string,
  input: AddRepresentativeInput,
) {
  const org = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE id = ?", [organizationId]);
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const aggregate = await getOrgAggregate(db, organizationId);
  // New representatives always inherit the organization's category — it's
  // no longer set per-representative. If the org has never had one set,
  // require staff to set it (PATCH .../organizations/:id) before adding
  // reps, rather than silently accepting an ad-hoc value here.
  if (!aggregate?.categoryCode) {
    throw new AppError(
      422,
      "ORG_CATEGORY_NOT_SET",
      "Set this organization's membership category before adding representatives",
    );
  }
  const memberId = aggregate.id;

  const existingUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [
    input.email.trim().toLowerCase(),
  ]);
  if (existingUser) {
    const alreadyRepresenting = await isActiveRepresentative(db, memberId, existingUser.id);
    if (alreadyRepresenting) {
      throw new AppError(409, "ALREADY_MEMBER", `${input.email} already represents this organization`);
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
    linksJson: input.linkedin ? serializeLinks([input.linkedin]) : null,
    allowProfileUpdate: true,
  });

  const now = nowIso();
  const { representativeId, statement } = buildAddRepresentativeStatement(db, { memberId, userId: user.id, now });
  await db.batch([statement]);

  const holders = await resolveRepresentativeRoleHolders(db, memberId);
  let assignedRole: "primary" | "secondary" | null = null;
  if (!holders.primaryContactUserId) {
    await db.batch(
      await buildAssignRepresentativeRoleStatements(db, {
        memberId,
        userId: user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        now,
      }),
    );
    assignedRole = "primary";
  } else if (!holders.secondaryContactUserId) {
    await db.batch(
      await buildAssignRepresentativeRoleStatements(db, {
        memberId,
        userId: user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        now,
      }),
    );
    assignedRole = "secondary";
  }

  return {
    // memberId is this representative's own organization_representatives.id
    // — see toOrgDetail's identical note — not the shared aggregate id.
    memberId: representativeId,
    userId: user.id,
    name: input.name,
    email: user.email,
    jobTitle: input.jobTitle ?? null,
    status: "active",
    showOnOrgProfile: true,
    isPrimaryContact: assignedRole === "primary",
    isSecondaryContact: assignedRole === "secondary",
    createdAt: now,
  };
}

// ── Single-member/representative edit/remove ──────────────────────────────
// `id` is ambiguous by design (see route header) — it may be an individual
// `members.id` or an `organization_representatives.id`. Disambiguated by
// lookup here rather than the route needing to know which.

export interface MemberUpdateInput {
  membershipCategory?: string;
  status?: string;
  showOnOrgProfile?: boolean;
}

interface IndividualMemberRow {
  id: string;
  user_id: string;
  status: string;
}

export async function updateAdminMember(db: DatabaseLike, id: string, input: MemberUpdateInput) {
  const representative = await first<{ id: string; member_id: string; user_id: string; show_on_org_profile: number }>(
    db,
    "SELECT id, member_id, user_id, show_on_org_profile FROM organization_representatives WHERE id = ? AND left_at IS NULL",
    [id],
  );

  if (representative) {
    if (input.membershipCategory !== undefined || input.status !== undefined) {
      throw new AppError(
        422,
        "REPRESENTATIVE_FIELD_NOT_EDITABLE",
        "A representative's category/status follow their organization's aggregate — edit those on the organization instead",
      );
    }
    if (input.showOnOrgProfile !== undefined) {
      await run(db, "UPDATE organization_representatives SET show_on_org_profile = ?, updated_at = ? WHERE id = ?", [
        input.showOnOrgProfile ? 1 : 0,
        nowIso(),
        id,
      ]);
    }
    const orgRow = await first<{ organization_id: string }>(db, "SELECT organization_id FROM members WHERE id = ?", [
      representative.member_id,
    ]);
    return {
      id,
      userId: representative.user_id,
      organizationId: orgRow?.organization_id ?? null,
      membershipCategory: null,
      status: "active",
      showOnOrgProfile: input.showOnOrgProfile ?? representative.show_on_org_profile === 1,
    };
  }

  const member = await first<IndividualMemberRow>(
    db,
    "SELECT id, user_id, status FROM members WHERE id = ? AND organization_id IS NULL",
    [id],
  );
  if (!member) throw new AppError(404, "NOT_FOUND", "Member not found");

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (input.status !== undefined) {
    setClauses.push("status = ?");
    values.push(input.status);
  }
  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso());
    values.push(id);
    await run(db, `UPDATE members SET ${setClauses.join(", ")} WHERE id = ?`, values);
  }
  if (input.membershipCategory !== undefined) {
    await run(db, `UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE member_id = ?`, [
      input.membershipCategory,
      nowIso(),
      id,
    ]);
  }

  return {
    id,
    userId: member.user_id,
    organizationId: null,
    membershipCategory: input.membershipCategory ?? null,
    status: input.status ?? member.status,
    showOnOrgProfile: true,
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
  const { memberId, statements } = buildCreateIndividualMemberStatements(db, userId, membershipCategory, now);
  await db.batch(statements);

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

// ── Secondary contact nomination confirmation ───────────────────

export interface ConfirmSecondaryContactResult {
  organizationId: string;
  secondaryContactUserId: string;
}

export async function confirmSecondaryContact(
  db: DatabaseLike,
  organizationId: string,
): Promise<ConfirmSecondaryContactResult> {
  const org = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE id = ?", [organizationId]);
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const aggregate = await getOrgAggregate(db, organizationId);
  const nomination = aggregate
    ? await first<{ nominated_user_id: string }>(
        db,
        "SELECT nominated_user_id FROM organization_secondary_contact_nominations WHERE member_id = ?",
        [aggregate.id],
      )
    : null;
  if (!aggregate || !nomination) {
    throw new AppError(409, "NO_PENDING_NOMINATION", "This organization has no pending secondary contact nomination");
  }

  const now = nowIso();
  await db.batch([
    ...(await buildAssignRepresentativeRoleStatements(db, {
      memberId: aggregate.id,
      userId: nomination.nominated_user_id,
      roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
      now,
    })),
    db.prepare("DELETE FROM organization_secondary_contact_nominations WHERE member_id = ?").bind(aggregate.id),
  ]);

  return { organizationId, secondaryContactUserId: nomination.nominated_user_id };
}

export async function removeAdminMember(
  db: DatabaseLike,
  id: string,
): Promise<{ user_id: string; organization_id: string | null }> {
  const representative = await first<{ id: string; member_id: string; user_id: string }>(
    db,
    "SELECT id, member_id, user_id FROM organization_representatives WHERE id = ? AND left_at IS NULL",
    [id],
  );

  if (representative) {
    const orgRow = await first<{ organization_id: string }>(db, "SELECT organization_id FROM members WHERE id = ?", [
      representative.member_id,
    ]);
    const now = nowIso();
    const statements: StatementLike[] = [
      buildCloseRepresentativeStatement(db, {
        memberId: representative.member_id,
        userId: representative.user_id,
        now,
      }),
      buildRevokeRepresentativeRoleStatement(db, {
        memberId: representative.member_id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        now,
      }),
      buildRevokeRepresentativeRoleStatement(db, {
        memberId: representative.member_id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        now,
      }),
      buildRevokeRepresentativeRoleStatement(db, {
        memberId: representative.member_id,
        roleId: REPRESENTATIVE_ROLE_IDS.votingDelegate,
        now,
      }),
      db
        .prepare("DELETE FROM organization_secondary_contact_nominations WHERE member_id = ? AND nominated_user_id = ?")
        .bind(representative.member_id, representative.user_id),
    ];
    // The two role-revoke statements above are unconditional UPDATEs (0
    // rows affected if that role wasn't held by this user) — safe as
    // no-ops, avoiding a read to check which role (if any) this rep held.
    await db.batch(statements);
    return { user_id: representative.user_id, organization_id: orgRow?.organization_id ?? null };
  }

  const member = await first<{ id: string; user_id: string }>(
    db,
    "SELECT id, user_id FROM members WHERE id = ? AND organization_id IS NULL",
    [id],
  );
  if (!member) throw new AppError(404, "NOT_FOUND", "Member not found");

  await run(db, "DELETE FROM member_category_assignments WHERE member_id = ?", [id]);
  await run(db, "DELETE FROM members WHERE id = ?", [id]);

  return { user_id: member.user_id, organization_id: null };
}

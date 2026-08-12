/**
 * Shared organization/user/member/working-group-membership creation logic
 * (approval onboarding). Mirrors the shape `admin-members.ts`'s
 * `createAdminMember` (Interim Admin Tool) already established — kept as
 * a separate function rather than a refactor of that already-shipped,
 * tested path, to avoid regression risk on working code; both call the same
 * underlying primitives (`findOrCreateUser`, `normalizeOrgName`).
 *
 * Adds one thing the Interim Admin Tool didn't need: writing
 * `organizations.organization_domains_json` at creation time, closing the
 * duplicate-check gap for organizations approved through this flow
 * going forward (see hasConflictingOrganizationDomain in
 * member-applications.ts).
 */
import { first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { findOrCreateUser } from "./users";
import { normalizeOrgName } from "./sponsorship";
import { stringifyJson } from "../utils/json";
import { serializeLinks } from "../../../assets/shared/schemas/api";
import type { DatabaseLike } from "../types";

export interface ProvisionRepresentative {
  name: string;
  email: string;
  jobTitle?: string | null;
  linkedin?: string | null;
}

export interface ProvisionOrganizationAndMembersInput {
  organizationName?: string | null;
  website?: string | null;
  description?: string | null;
  organizationDomain?: string | null;
  membershipCategory: string;
  representatives: ProvisionRepresentative[];
  workingGroupSlugs: string[];
}

export interface ProvisionedMember {
  memberId: string;
  userId: string;
  email: string;
  name: string;
  organizationId: string | null;
  /** True only when this call just assigned this person as primary/secondary contact (not on an already-contacted org). */
  assignedContactRole: "primary" | "secondary" | null;
}

export interface ProvisionOrganizationAndMembersResult {
  organizationId: string | null;
  organizationWasCreated: boolean;
  members: ProvisionedMember[];
}

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

export async function provisionOrganizationAndMembers(
  db: DatabaseLike,
  input: ProvisionOrganizationAndMembersInput,
): Promise<ProvisionOrganizationAndMembersResult> {
  let organizationId: string | null = null;
  let organizationWasCreated = false;

  if (input.organizationName) {
    const normalizedOrgName = normalizeOrgName(input.organizationName);
    const existingOrg = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
      normalizedOrgName,
    ]);

    if (existingOrg) {
      organizationId = existingOrg.id;
    } else {
      organizationId = uuid();
      organizationWasCreated = true;
      const now = nowIso();
      await run(
        db,
        `INSERT INTO organizations (id, name, normalized_name, data_json, description, website, organization_domains_json, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          organizationId,
          input.organizationName,
          normalizedOrgName,
          input.description ?? null,
          input.website ?? null,
          input.organizationDomain ? stringifyJson([input.organizationDomain]) : null,
          now,
          now,
        ],
      );
    }
  }

  const members: ProvisionedMember[] = [];

  for (const [index, rep] of input.representatives.entries()) {
    const { firstName, lastName } = splitName(rep.name);
    const user = await findOrCreateUser(db, {
      email: rep.email,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      jobTitle: rep.jobTitle ?? undefined,
      linksJson: rep.linkedin ? serializeLinks([rep.linkedin]) : null,
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

    let assignedContactRole: "primary" | "secondary" | null = null;
    if (organizationId && index === 0) {
      const result = await run(
        db,
        `UPDATE organizations SET primary_contact_user_id = ?, updated_at = ? WHERE id = ? AND primary_contact_user_id IS NULL`,
        [user.id, now, organizationId],
      );
      if (result.changes > 0) assignedContactRole = "primary";
    }
    if (organizationId && index === 1) {
      const result = await run(
        db,
        `UPDATE organizations SET secondary_contact_user_id = ?, updated_at = ? WHERE id = ? AND secondary_contact_user_id IS NULL`,
        [user.id, now, organizationId],
      );
      if (result.changes > 0) assignedContactRole = "secondary";
    }

    for (const slug of input.workingGroupSlugs) {
      const wg = await first<{ id: string }>(db, "SELECT id FROM working_groups WHERE slug = ?", [slug]);
      if (!wg) continue;
      const existingMembership = await first<{ id: string }>(
        db,
        "SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL",
        [wg.id, user.id],
      );
      if (existingMembership) continue;
      await run(
        db,
        `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at) VALUES (?, ?, ?, ?, NULL)`,
        [uuid(), wg.id, user.id, now],
      );
    }

    members.push({
      memberId,
      userId: user.id,
      email: user.email,
      name: rep.name,
      organizationId,
      assignedContactRole,
    });
  }

  return { organizationId, organizationWasCreated, members };
}

/**
 * Shared organization/user/member/working-group-membership creation logic
 * (approval onboarding). Mirrors the shape `admin-members.ts`'s
 * `createAdminMember` (Interim Admin Tool) already established — kept as
 * a separate function rather than a refactor of that already-shipped,
 * tested path, to avoid regression risk on working code; both call the same
 * underlying primitives (`buildFindOrCreateUserStatement`, `normalizeOrgName`,
 * `buildAddWorkingGroupMemberStatements`) and land every write in one
 * atomic `db.batch()`, so a later failure can't leave a partially
 * provisioned membership or an orphaned `users` row.
 *
 * Adds one thing the Interim Admin Tool didn't need: recording an
 * `organization_domains` row at creation time, closing the duplicate-check
 * gap for organizations approved through this flow going forward (see
 * hasConflictingOrganizationDomain in member-applications.ts).
 */
import { first } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { buildFindOrCreateUserStatement, type UserRecord } from "./users";
import { normalizeOrgName } from "./sponsorship";
import { getWorkingGroupBySlugOrId, buildAddWorkingGroupMemberStatements } from "./working-groups";
import { serializeLinks } from "../../../assets/shared/schemas/api";
import type { DatabaseLike, StatementLike } from "../types";

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

interface PendingMember {
  rep: ProvisionRepresentative;
  user: UserRecord;
  memberId: string;
  /** Index into `statements` of this rep's contact-assignment UPDATE, or null if none was queued. */
  contactStatementIndex: number | null;
  contactRole: "primary" | "secondary" | null;
}

export async function provisionOrganizationAndMembers(
  db: DatabaseLike,
  input: ProvisionOrganizationAndMembersInput,
): Promise<ProvisionOrganizationAndMembersResult> {
  const now = nowIso();
  const statements: StatementLike[] = [];

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
      statements.push(
        db
          .prepare(
            `INSERT INTO organizations (id, name, normalized_name, data_json, description, website, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
          )
          .bind(
            organizationId,
            input.organizationName,
            normalizedOrgName,
            input.description ?? null,
            input.website ?? null,
            now,
            now,
          ),
      );
      if (input.organizationDomain) {
        statements.push(
          db
            .prepare(`INSERT INTO organization_domains (id, organization_id, domain, created_at) VALUES (?, ?, ?, ?)`)
            .bind(uuid(), organizationId, input.organizationDomain, now),
        );
      }
    }
  }

  const pending: PendingMember[] = [];

  for (const [index, rep] of input.representatives.entries()) {
    const { firstName, lastName } = splitName(rep.name);
    const { user, statement: userStatement } = await buildFindOrCreateUserStatement(db, {
      email: rep.email,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      jobTitle: rep.jobTitle ?? undefined,
      linksJson: rep.linkedin ? serializeLinks([rep.linkedin]) : null,
      allowProfileUpdate: true,
    });
    if (userStatement) statements.push(userStatement);

    const memberId = uuid();
    statements.push(
      db
        .prepare(
          `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at, show_on_org_profile)
           VALUES (?, ?, ?, ?, 'active', NULL, NULL, ?, ?, 1)`,
        )
        .bind(memberId, input.membershipCategory, user.id, organizationId, now, now),
    );

    let contactStatementIndex: number | null = null;
    let contactRole: "primary" | "secondary" | null = null;
    if (organizationId && index === 0) {
      contactRole = "primary";
      contactStatementIndex = statements.length;
      statements.push(
        db
          .prepare(
            `UPDATE organizations SET primary_contact_user_id = ?, updated_at = ? WHERE id = ? AND primary_contact_user_id IS NULL`,
          )
          .bind(user.id, now, organizationId),
      );
    }
    if (organizationId && index === 1) {
      contactRole = "secondary";
      contactStatementIndex = statements.length;
      statements.push(
        db
          .prepare(
            `UPDATE organizations SET secondary_contact_user_id = ?, updated_at = ? WHERE id = ? AND secondary_contact_user_id IS NULL`,
          )
          .bind(user.id, now, organizationId),
      );
    }

    for (const slug of input.workingGroupSlugs) {
      const wg = await getWorkingGroupBySlugOrId(db, slug);
      if (!wg) continue;
      statements.push(...(await buildAddWorkingGroupMemberStatements(db, wg, user.id)));
    }

    pending.push({ rep, user, memberId, contactStatementIndex, contactRole });
  }

  const results = statements.length > 0 ? await db.batch(statements) : [];

  const members: ProvisionedMember[] = pending.map(({ rep, user, memberId, contactStatementIndex, contactRole }) => {
    let assignedContactRole: "primary" | "secondary" | null = null;
    if (contactStatementIndex !== null) {
      const changes =
        (results[contactStatementIndex] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
      if (changes > 0) assignedContactRole = contactRole;
    }
    return {
      memberId,
      userId: user.id,
      email: user.email,
      name: rep.name,
      organizationId,
      assignedContactRole,
    };
  });

  return { organizationId, organizationWasCreated, members };
}

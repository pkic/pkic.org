/**
 * Admin Organizations representative/member provisioning — adding,
 * editing, and removing an organization's representatives
 * (`organization_representatives`, consolidated migration 0035), granting org-less
 * individual memberships, and confirming secondary-contact nominations.
 * Split from the combined admin-organizations.ts (PR #1 review, Phase 8) —
 * see queries.ts for reads and profile.ts for the organization
 * profile-update use case.
 *
 * `id` is ambiguous by design in updateAdminMember/removeAdminMember (see
 * the route header) — it may be an individual `members.id` or an
 * `organization_representatives.id`. Disambiguated by lookup here rather
 * than the route needing to know which.
 */
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { buildFindOrCreateUserStatement, findUserByEmail, splitPersonName } from "../users";
import { serializeLinks } from "../../../../assets/shared/schemas/links";
import { buildCreateIndividualMemberStatements } from "../membership/memberships";
import { isActiveRepresentative, buildAddRepresentativeStatement } from "../membership/representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  resolveRepresentativeRoleHolders,
  buildAssignRepresentativeRoleStatements,
  buildAssignRepresentativeRoleStatementsForNewRepresentative,
  buildRevokeRepresentativeRoleStatement,
} from "../membership/representative-roles";
import { prepareAuditLog } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { prepareQueueEmailStatement } from "../../email/outbox";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { getOrgAggregate } from "./queries";
import { buildMembershipAccessOffboardingStatements } from "../membership/offboarding";
import { adminDatabaseUserId } from "../../auth/admin-identity";

export interface AddRepresentativeInput {
  name: string;
  email: string;
  jobTitle?: string;
  links?: string[];
}

export async function addOrganizationRepresentative(
  db: DatabaseLike,
  actor: AuthAdmin,
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

  const existingUser = await findUserByEmail(db, input.email);
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
  const { firstName, lastName } = existingUser
    ? { firstName: undefined, lastName: undefined }
    : splitPersonName(input.name);
  const { user, statement: userStatement } = await buildFindOrCreateUserStatement(db, {
    email: input.email,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
    jobTitle: input.jobTitle,
    linksJson: input.links && input.links.length > 0 ? serializeLinks(input.links) : null,
    allowProfileUpdate: true,
  });

  const now = nowIso();
  const { representativeId, statement } = await buildAddRepresentativeStatement(db, {
    memberId,
    userId: user.id,
    source: "staff",
    now,
  });
  const holders = await resolveRepresentativeRoleHolders(db, memberId);
  const statements: StatementLike[] = [];
  if (userStatement) statements.push(userStatement);
  statements.push(statement);
  let assignedRole: "primary" | "secondary" | null = null;
  if (!holders.primaryContactUserId) {
    statements.push(
      ...buildAssignRepresentativeRoleStatementsForNewRepresentative(db, {
        memberId,
        userId: user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        grantedByUserId: adminDatabaseUserId(actor),
        now,
      }),
    );
    assignedRole = "primary";
  } else if (!holders.secondaryContactUserId) {
    statements.push(
      ...buildAssignRepresentativeRoleStatementsForNewRepresentative(db, {
        memberId,
        userId: user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        grantedByUserId: adminDatabaseUserId(actor),
        now,
      }),
    );
    assignedRole = "secondary";
  }
  statements.push(
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, user.id, now),
    prepareAuditLog(db, "admin", actor.id, "organization_representative_added", "organization", organizationId, {
      representativeId,
      email: user.email,
    }),
  );
  await db.batch(statements);

  return {
    // representativeId/membershipId — see queries.ts's toOrgDetail's identical note.
    representativeId,
    membershipId: memberId,
    userId: user.id,
    name: input.name,
    email: user.email,
    jobTitle: input.jobTitle ?? null,
    links: input.links ?? [],
    status: "active",
    showOnOrgProfile: true,
    isPrimaryContact: assignedRole === "primary",
    isSecondaryContact: assignedRole === "secondary",
    createdAt: now,
  };
}

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

export async function updateAdminMember(db: DatabaseLike, actorUserId: string, id: string, input: MemberUpdateInput) {
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
      await db.batch([
        db
          .prepare("UPDATE organization_representatives SET show_on_org_profile = ?, updated_at = ? WHERE id = ?")
          .bind(input.showOnOrgProfile ? 1 : 0, nowIso(), id),
        prepareAuditLog(db, "admin", actorUserId, "member_updated", "member", id, input),
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

  const statements: StatementLike[] = [];
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
    statements.push(db.prepare(`UPDATE members SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values));
  }
  if (input.membershipCategory !== undefined) {
    statements.push(
      db
        .prepare(`UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE member_id = ?`)
        .bind(input.membershipCategory, nowIso(), id),
    );
  }
  if (input.membershipCategory !== undefined || input.status !== undefined) {
    statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(db, member.user_id, nowIso()));
  }
  if (member.status === "active" && input.status !== undefined && input.status !== "active") {
    statements.push(
      ...(await buildMembershipAccessOffboardingStatements(db, {
        userId: member.user_id,
        memberId: member.id,
        causeKey: `member:${member.id}:status:${member.status}->${input.status}`,
        at: nowIso(),
      })),
    );
  }
  statements.push(prepareAuditLog(db, "admin", actorUserId, "member_updated", "member", id, input));
  await db.batch(statements);

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
export async function grantIndividualMembership(
  db: DatabaseLike,
  actorUserId: string,
  userId: string,
  membershipCategory: string,
) {
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [userId]);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const existingMember = await first<{ id: string }>(db, "SELECT id FROM members WHERE user_id = ?", [userId]);
  if (existingMember) throw new AppError(409, "ALREADY_MEMBER", "This user already holds a membership");

  const now = nowIso();
  const { memberId, statements } = buildCreateIndividualMemberStatements(db, userId, membershipCategory, now);
  statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(db, userId, now));
  statements.push(
    prepareAuditLog(db, "admin", actorUserId, "member_created", "member", memberId, {
      userId,
      membershipCategory,
    }),
  );
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

export interface ConfirmSecondaryContactResult {
  organizationId: string;
  secondaryContactUserId: string;
  outboxId: string | null;
}

export async function confirmSecondaryContact(
  db: DatabaseLike,
  actor: AuthAdmin,
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

  const contact = await first<{ email: string; first_name: string | null; last_name: string | null }>(
    db,
    "SELECT email, first_name, last_name FROM users WHERE id = ?",
    [nomination.nominated_user_id],
  );

  const now = nowIso();
  const statements: StatementLike[] = [
    ...(await buildAssignRepresentativeRoleStatements(db, {
      memberId: aggregate.id,
      userId: nomination.nominated_user_id,
      roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
      grantedByUserId: adminDatabaseUserId(actor),
      now,
    })),
    db.prepare("DELETE FROM organization_secondary_contact_nominations WHERE member_id = ?").bind(aggregate.id),
    prepareAuditLog(db, "admin", actor.id, "organization_secondary_contact_confirmed", "organization", organizationId, {
      secondaryContactUserId: nomination.nominated_user_id,
    }),
  ];
  const preparedEmail = contact
    ? prepareQueueEmailStatement(db, {
        templateKey: "org-contact-assigned",
        recipientEmail: contact.email,
        recipientUserId: nomination.nominated_user_id,
        messageType: "transactional",
        subject: "You have been designated an organization contact",
        data: {
          memberName: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email,
          contactRole: "secondary",
        },
      })
    : null;
  if (preparedEmail) statements.push(preparedEmail.statement);
  await db.batch(statements);

  return { organizationId, secondaryContactUserId: nomination.nominated_user_id, outboxId: preparedEmail?.id ?? null };
}

export async function removeAdminMember(
  db: DatabaseLike,
  actorUserId: string,
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
    const databaseActor = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [actorUserId]);
    const now = nowIso();
    const statements: StatementLike[] = [
      db
        .prepare(
          `UPDATE organization_representatives
              SET left_at = ?, blocked_at = ?, blocked_by_user_id = ?, updated_at = ?
            WHERE id = ? AND left_at IS NULL AND blocked_at IS NULL`,
        )
        .bind(now, now, databaseActor?.id ?? null, now, representative.id),
      buildRevokeRepresentativeRoleStatement(db, {
        memberId: representative.member_id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        userId: representative.user_id,
        now,
      }),
      buildRevokeRepresentativeRoleStatement(db, {
        memberId: representative.member_id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        userId: representative.user_id,
        now,
      }),
      buildRevokeRepresentativeRoleStatement(db, {
        memberId: representative.member_id,
        roleId: REPRESENTATIVE_ROLE_IDS.votingDelegate,
        userId: representative.user_id,
        now,
      }),
      db
        .prepare("DELETE FROM organization_secondary_contact_nominations WHERE member_id = ? AND nominated_user_id = ?")
        .bind(representative.member_id, representative.user_id),
      ...(await buildMembershipAccessOffboardingStatements(db, {
        userId: representative.user_id,
        memberId: representative.member_id,
        causeKey: `representative:${representative.id}:removed`,
        at: now,
      })),
      ...prepareAutomaticGroupEnrollmentForUserStatements(db, representative.user_id, now),
      prepareAuditLog(db, "admin", actorUserId, "member_removed", "member", id, {
        userId: representative.user_id,
        organizationId: orgRow?.organization_id ?? null,
      }),
    ];
    // The three role-revoke statements above are scoped to this
    // representative's own user_id (0 rows affected if they didn't hold
    // that role) — safe as no-ops, avoiding a read to check which role (if
    // any) this rep held, and critically NOT clearing a role actually held
    // by a different representative of the same organization.
    await db.batch(statements);
    return { user_id: representative.user_id, organization_id: orgRow?.organization_id ?? null };
  }

  const member = await first<{ id: string; user_id: string }>(
    db,
    "SELECT id, user_id FROM members WHERE id = ? AND organization_id IS NULL",
    [id],
  );
  if (!member) throw new AppError(404, "NOT_FOUND", "Member not found");

  const at = nowIso();
  await db.batch([
    ...(await buildMembershipAccessOffboardingStatements(db, {
      userId: member.user_id,
      memberId: member.id,
      causeKey: `member:${member.id}:removed`,
      at,
    })),
    db.prepare("UPDATE members SET status = 'inactive', updated_at = ? WHERE id = ?").bind(at, id),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, member.user_id, at),
    prepareAuditLog(db, "admin", actorUserId, "member_removed", "member", id, {
      userId: member.user_id,
      organizationId: null,
    }),
  ]);

  return { user_id: member.user_id, organization_id: null };
}

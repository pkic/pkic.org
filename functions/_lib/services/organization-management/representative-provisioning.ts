/**
 * Organization representative provisioning — adding representatives and
 * confirming secondary-contact nominations (`organization_representatives`,
 * consolidated migration 0035).
 * Split from the prior combined organization module (PR #1 review, Phase 8) —
 * see queries.ts for reads and profile.ts for the organization
 * profile-update use case.
 *
 * Membership capacity updates and removals are deliberately owned by
 * `membership/capacities.ts`, so the organization service remains scoped to
 * organization-context representative workflows.
 */
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { buildFindOrCreateUserStatement, findUserByEmail, splitPersonName } from "../users";
import { serializeLinks } from "../../../../assets/shared/schemas/links";
import { isActiveRepresentative, buildAddRepresentativeStatement } from "../membership/representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  resolveRepresentativeRoleHolders,
  buildAssignRepresentativeRoleStatements,
  buildAssignRepresentativeRoleStatementsForNewRepresentative,
} from "../membership/representative-roles";
import { prepareAuditLog } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { prepareQueueEmailStatement } from "../../email/outbox";
import type { AuthAdmin, DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { getOrgAggregate } from "./read-model";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { authorizedOrganizationMutationDb } from "./authorization";

export interface AddRepresentativeInput {
  name: string;
  email: string;
  jobTitle?: string;
  biography?: string;
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
    const individualMembership = await first<{ id: string }>(
      db,
      "SELECT id FROM members WHERE user_id = ? AND member_type = 'individual' AND status = 'active'",
      [existingUser.id],
    );
    if (individualMembership) {
      throw new AppError(
        409,
        "INDIVIDUAL_CAPACITY_CONFLICT",
        "End the individual membership before adding an organization representation",
      );
    }
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
  });

  const now = nowIso();
  const { representativeId, statement } = await buildAddRepresentativeStatement(db, {
    memberId,
    userId: user.id,
    jobTitle: input.jobTitle ?? null,
    biography: input.biography ?? null,
    linksJson: input.links ? serializeLinks(input.links) : null,
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
    emailId: null,
    jobTitle: input.jobTitle ?? null,
    biography: input.biography ?? null,
    links: input.links ?? [],
    status: "active",
    showOnOrgProfile: true,
    isPrimaryContact: assignedRole === "primary",
    isSecondaryContact: assignedRole === "secondary",
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
  actor: UserBackedAuthAdmin,
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

  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  const now = nowIso();
  const statements: StatementLike[] = [
    ...(await buildAssignRepresentativeRoleStatements(authorizedDb, {
      memberId: aggregate.id,
      userId: nomination.nominated_user_id,
      roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
      grantedByUserId: adminDatabaseUserId(actor),
      now,
    })),
    authorizedDb
      .prepare("DELETE FROM organization_secondary_contact_nominations WHERE member_id = ?")
      .bind(aggregate.id),
    prepareAuditLog(
      authorizedDb,
      "admin",
      actor.id,
      "organization_secondary_contact_confirmed",
      "organization",
      organizationId,
      {
        secondaryContactUserId: nomination.nominated_user_id,
      },
    ),
  ];
  const preparedEmail = contact
    ? prepareQueueEmailStatement(authorizedDb, {
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
  await authorizedDb.batch(statements);

  return { organizationId, secondaryContactUserId: nomination.nominated_user_id, outboxId: preparedEmail?.id ?? null };
}

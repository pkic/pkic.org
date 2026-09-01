import { adminDatabaseUserId } from "../../auth/admin-identity";
import { first } from "../../db/queries";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { REPRESENTATIVE_ROLE_IDS, buildAssignRepresentativeRoleStatements } from "../membership/representative-roles";
import { authorizedOrganizationMutationDb } from "./authorization";
import { getOrgAggregate } from "./read-model";

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
  const organization = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE id = ?", [organizationId]);
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");

  const aggregate = await getOrgAggregate(db, organizationId);
  const nomination = aggregate
    ? await first<{ nominated_user_id: string }>(
        db,
        "SELECT nominated_user_id FROM organization_secondary_contact_nominations WHERE member_id = ?",
        [aggregate.id],
      )
    : null;
  if (!aggregate || !nomination) {
    throw new AppError(409, "NO_PENDING_NOMINATION", "This organization has no pending secondary-contact nomination");
  }

  const contact = await first<{ email: string; first_name: string | null; last_name: string | null }>(
    db,
    "SELECT email, first_name, last_name FROM users WHERE id = ? AND active = 1",
    [nomination.nominated_user_id],
  );
  if (!contact) throw new AppError(409, "IDENTITY_INACTIVE", "The nominated identity is no longer active");

  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  const at = nowIso();
  const statements: StatementLike[] = [
    ...(await buildAssignRepresentativeRoleStatements(authorizedDb, {
      memberId: aggregate.id,
      userId: nomination.nominated_user_id,
      roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
      grantedByUserId: adminDatabaseUserId(actor),
      now: at,
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
      { secondaryContactUserId: nomination.nominated_user_id },
      at,
    ),
  ];
  const preparedEmail = prepareQueueEmailStatement(
    authorizedDb,
    {
      templateKey: "org-contact-assigned",
      recipientEmail: contact.email,
      recipientUserId: nomination.nominated_user_id,
      messageType: "transactional",
      subject: "You have been designated an organization contact",
      data: {
        memberName: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email,
        contactRole: "secondary",
      },
    },
    at,
  );
  statements.push(preparedEmail.statement);
  await authorizedDb.batch(statements);

  return {
    organizationId,
    secondaryContactUserId: nomination.nominated_user_id,
    outboxId: preparedEmail.id,
  };
}

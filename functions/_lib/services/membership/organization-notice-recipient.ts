import { normalizedEmailSchema } from "../../../../assets/shared/schemas/api-common";
import { REPRESENTATIVE_ROLE_IDS } from "../../../../assets/shared/schemas/representative-roles";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { organizationContactRoleActivePredicate } from "./representative-roles";

/** Current contact role first; the independent mailbox remains usable after every representation ends. */
export async function resolveOrganizationNoticeRecipient(db: DatabaseLike, organizationId: string) {
  const row = await first<{
    organizationName: string;
    privateEmail: string | null;
    contactEmail: string | null;
    contactName: string | null;
    hasCurrentRepresentatives: number;
  }>(
    db,
    `SELECT organization.name AS organizationName, details.email AS privateEmail,
      contact.email AS contactEmail, contact.name AS contactName,
      EXISTS(SELECT 1 FROM identities representative JOIN users person ON person.id=representative.user_id
        WHERE representative.organization_id=organization.id AND representative.started_at IS NOT NULL
          AND representative.ended_at IS NULL AND representative.blocked_at IS NULL AND person.active=1) AS hasCurrentRepresentatives
    FROM organizations organization
    LEFT JOIN organization_contact_details details ON details.organization_id=organization.id
    LEFT JOIN (
      SELECT member.organization_id, u.email, trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name
      FROM members member
      JOIN user_roles ur ON ur.context_type='organization' AND ur.context_id=member.id
      JOIN users u ON u.id=ur.user_id
      JOIN identities identity ON identity.id=ur.identity_id AND identity.user_id=ur.user_id
      JOIN identity_member_capacities capacity ON capacity.identity_id=identity.id AND capacity.member_id=member.id
      WHERE member.organization_id=? AND member.status='active' AND ur.role_id IN (?, ?)
        AND ${organizationContactRoleActivePredicate()}
      ORDER BY CASE ur.role_id WHEN ? THEN 0 ELSE 1 END, ur.id LIMIT 1
    ) contact ON contact.organization_id=organization.id
    WHERE organization.id=? AND organization.merged_into_organization_id IS NULL`,
    [
      organizationId,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      REPRESENTATIVE_ROLE_IDS.secondaryContact,
      nowIso(),
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      organizationId,
    ],
  );
  if (!row) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  const email = normalizedEmailSchema.safeParse(row.contactEmail ?? row.privateEmail);
  if (!email.success) {
    throw new AppError(
      409,
      "ORGANIZATION_CONTACT_MISSING",
      "Staff must establish an organization contact email before sending a notice",
    );
  }
  return {
    organizationName: row.organizationName,
    recipientEmail: email.data,
    contactName: row.contactEmail ? row.contactName : null,
    source: row.contactEmail ? ("representative" as const) : ("organization" as const),
    noCurrentRepresentatives: !row.hasCurrentRepresentatives,
  };
}

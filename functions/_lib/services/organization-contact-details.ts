import type {
  OrganizationContactDetails,
  OrganizationContactDetailsUpdate,
} from "../../../assets/shared/schemas/organization-contact-details";
import {
  organizationContactDetailsSchema,
  parseOrganizationPostalAddressJson,
  serializeOrganizationPostalAddress,
} from "../../../assets/shared/schemas/organization-contact-details";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";

async function requireOrganization(db: DatabaseLike, organizationId: string) {
  const organization = await first<{ id: string }>(
    db,
    "SELECT id FROM organizations WHERE id = ? AND merged_into_organization_id IS NULL",
    [organizationId],
  );
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
}

export async function readOrganizationContactDetails(db: DatabaseLike, organizationId: string) {
  await requireOrganization(db, organizationId);
  const row = await first<Omit<OrganizationContactDetails, "postalAddress"> & { postalAddress: string | null }>(
    db,
    `SELECT email, phone, postal_address_json AS postalAddress, country_code AS countryCode,
            revision, updated_at AS updatedAt, updated_by_user_id AS updatedByUserId
       FROM organization_contact_details WHERE organization_id = ?`,
    [organizationId],
  );
  return {
    contactDetails: row
      ? organizationContactDetailsSchema.parse({
          ...row,
          postalAddress: parseOrganizationPostalAddressJson(row.postalAddress),
        })
      : null,
  };
}

/** The caller supplies a database guarded by its exact live session and organization authority. */
export async function saveOrganizationContactDetails(
  db: DatabaseLike,
  actor: { userId: string; actorType: "admin" | "member" },
  organizationId: string,
  input: OrganizationContactDetailsUpdate,
) {
  await requireOrganization(db, organizationId);
  const now = nowIso();
  const details = { ...input, revision: input.revision + 1, updatedAt: now, updatedByUserId: actor.userId };
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO organization_contact_details
        (organization_id, email, phone, postal_address_json, country_code, revision, updated_at, updated_by_user_id)
        SELECT id, ?, ?, ?, ?, ?, ?, ? FROM organizations
         WHERE id = ? AND merged_into_organization_id IS NULL
           AND (? = 0 OR EXISTS (SELECT 1 FROM organization_contact_details WHERE organization_id = ? AND revision = ?))
        ON CONFLICT(organization_id) DO UPDATE SET
          email=excluded.email, phone=excluded.phone, postal_address_json=excluded.postal_address_json,
          country_code=excluded.country_code, revision=excluded.revision,
          updated_at=excluded.updated_at, updated_by_user_id=excluded.updated_by_user_id
        WHERE organization_contact_details.revision = ?`)
        .bind(
          input.email,
          input.phone,
          serializeOrganizationPostalAddress(input.postalAddress),
          input.countryCode,
          details.revision,
          now,
          actor.userId,
          organizationId,
          input.revision,
          organizationId,
          input.revision,
          input.revision,
        ),
      // Record provenance without replicating private values into the general audit feed.
      prepareAuditLogAfterOneChange(
        db,
        actor.actorType,
        actor.userId,
        "organization_contact_details_updated",
        "organization",
        organizationId,
        { revision: details.revision, fields: ["email", "phone", "postalAddress", "countryCode"] },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "CONTACT_DETAILS_CHANGED", "Contact details changed; reload before saving again");
    }
    throw error;
  }
  return { contactDetails: details };
}

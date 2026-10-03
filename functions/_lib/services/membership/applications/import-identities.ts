import type { ApplicationImportMapping } from "../../../../../assets/shared/schemas/membership-application-import";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike, StatementLike } from "../../../types";

/** Similar names never establish identity; reviewed links must still match exact indexed identities. */
export async function prepareImportedIdentityLinks(
  db: DatabaseLike,
  mapping: ApplicationImportMapping,
): Promise<StatementLike[]> {
  const statements: StatementLike[] = [];
  if (mapping.applicantEmail) {
    const existing = await first<{ id: string }>(
      db,
      "SELECT id FROM member_applications WHERE applicant_email = ? LIMIT 1",
      [mapping.applicantEmail],
    );
    if (existing)
      throw new AppError(
        409,
        "IMPORT_EXISTING_APPLICATION",
        "Reconcile the existing portal application before importing this source",
      );
  }
  if (mapping.applicantUserId) {
    if (!mapping.applicantEmail)
      throw new AppError(422, "IMPORT_IDENTITY_EVIDENCE_REQUIRED", "A user link requires an exact email match");
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM users WHERE id = ? AND normalized_email = ?",
        bindings: [mapping.applicantUserId, mapping.applicantEmail],
      }),
    );
  }
  if (mapping.organizationId) {
    const domain = mapping.applicantEmail?.split("@")[1];
    if (!domain)
      throw new AppError(
        422,
        "IMPORT_IDENTITY_EVIDENCE_REQUIRED",
        "An organization link requires an exact domain claim",
      );
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM organization_domain_claims WHERE organization_id = ? AND domain = ?",
        bindings: [mapping.organizationId, domain],
      }),
    );
  }
  return statements;
}

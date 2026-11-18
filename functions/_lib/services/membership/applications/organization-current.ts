import type { z } from "zod";
import { identitiesListQuerySchema } from "../../../../../assets/shared/schemas/identity";
import type { organizationCurrentApplicationSchema } from "../../../../../assets/shared/schemas/organization-self-service";
import { batchFirst } from "../../../db/pagination";
import type { DatabaseLike } from "../../../types";
import { persistedUtcInstant } from "../../../utils/time";
import { prepareIdentitiesList } from "../../identities/read-model";
import { openOrganizationApplicationsWhere } from "./conflicts";

type OrganizationCurrentApplication = z.infer<typeof organizationCurrentApplicationSchema>;

/**
 * The organization's open membership application, with the identity its
 * applicant holds at the organization, read in one round trip. The applicant's
 * name and title come from that identity, never from the copy the application
 * kept.
 */
export async function readOrganizationCurrentApplication(
  db: DatabaseLike,
  organizationId: string,
): Promise<OrganizationCurrentApplication | null> {
  const open = openOrganizationApplicationsWhere(organizationId);
  const current = `FROM member_applications WHERE ${open.sql} ORDER BY created_at, id LIMIT 1`;
  const applicant = prepareIdentitiesList(db, identitiesListQuerySchema.parse({ active: "true", limit: 1 }), {
    organizationId,
    userSelection: { sql: `SELECT applicant_user_id ${current}`, bindings: open.bindings },
  });
  const [application, ...identityResults] = await db.batch([
    db.prepare(`SELECT stage, created_at ${current}`).bind(...open.bindings),
    ...applicant.statements,
  ]);
  const row = batchFirst<{ stage: OrganizationCurrentApplication["stage"]; created_at: string }>(application);
  if (!row) return null;
  const identity = applicant.decode(identityResults).identities[0];
  return {
    stage: row.stage,
    createdAt: persistedUtcInstant(row.created_at),
    applicant: identity
      ? {
          id: identity.id,
          userId: identity.userId,
          userName: identity.userName,
          email: identity.email,
          jobTitle: identity.jobTitle,
          headshotUrl: identity.headshotUrl,
        }
      : null,
  };
}

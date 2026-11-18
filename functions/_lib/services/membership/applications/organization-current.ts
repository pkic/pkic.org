import type { z } from "zod";
import { APPLICATION_TERMINAL_STAGES } from "../../../../../assets/shared/schemas/member-applications";
import { identitiesListQuerySchema } from "../../../../../assets/shared/schemas/identity";
import type { organizationCurrentApplicationSchema } from "../../../../../assets/shared/schemas/organization-self-service";
import type { DatabaseLike } from "../../../types";
import { persistedUtcInstant } from "../../../utils/time";
import { prepareIdentitiesList } from "../../identities/read-model";

type OrganizationCurrentApplication = z.infer<typeof organizationCurrentApplicationSchema>;

/**
 * The organization's open membership application, with the identity its
 * applicant holds at the organization. The applicant's name and title come
 * from that identity, never from the copy the application kept.
 */
export async function readOrganizationCurrentApplication(
  db: DatabaseLike,
  organizationId: string,
): Promise<OrganizationCurrentApplication | null> {
  const row = await db
    .prepare(
      `SELECT stage, created_at, applicant_user_id FROM member_applications
        WHERE organization_id = ? AND stage NOT IN (${APPLICATION_TERMINAL_STAGES.map(() => "?").join(", ")})
        ORDER BY created_at, id LIMIT 1`,
    )
    .bind(organizationId, ...APPLICATION_TERMINAL_STAGES)
    .first<{ stage: OrganizationCurrentApplication["stage"]; created_at: string; applicant_user_id: string | null }>();
  if (!row) return null;
  let applicant: OrganizationCurrentApplication["applicant"] = null;
  if (row.applicant_user_id) {
    const read = prepareIdentitiesList(
      db,
      identitiesListQuerySchema.parse({ userId: row.applicant_user_id, active: "true", limit: 1 }),
      { organizationId },
    );
    const identity = read.decode(await db.batch(read.statements)).identities[0];
    if (identity) {
      const { id, userId, userName, email, jobTitle, headshotUrl } = identity;
      applicant = { id, userId, userName, email, jobTitle, headshotUrl };
    }
  }
  return { stage: row.stage, createdAt: persistedUtcInstant(row.created_at), applicant };
}

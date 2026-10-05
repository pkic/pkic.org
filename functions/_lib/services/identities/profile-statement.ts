import { serializeLinks } from "../../../../assets/shared/schemas/links";
import type { DatabaseLike } from "../../types";

export function prepareIdentityProfileUpdateStatement(
  db: DatabaseLike,
  identity: { id: string; updated_at: string },
  input: {
    emailId?: string | null;
    jobTitle?: string | null;
    biography?: string | null;
    links?: string[];
    showOnOrganizationProfile?: boolean;
  },
  at: string,
) {
  return db
    .prepare(
      `UPDATE identities
            SET email_id = CASE WHEN ? = 1 THEN ? ELSE email_id END,
                job_title = CASE WHEN ? = 1 THEN ? ELSE job_title END,
                biography = CASE WHEN ? = 1 THEN ? ELSE biography END,
                links_json = CASE WHEN ? = 1 THEN ? ELSE links_json END,
                show_on_organization_profile = CASE WHEN ? = 1 THEN ? ELSE show_on_organization_profile END,
                updated_at = ?
          WHERE id = ? AND ended_at IS NULL AND blocked_at IS NULL AND updated_at = ?`,
    )
    .bind(
      input.emailId !== undefined ? 1 : 0,
      input.emailId ?? null,
      input.jobTitle !== undefined ? 1 : 0,
      input.jobTitle ?? null,
      input.biography !== undefined ? 1 : 0,
      input.biography ?? null,
      input.links !== undefined ? 1 : 0,
      input.links === undefined ? null : serializeLinks(input.links),
      input.showOnOrganizationProfile !== undefined ? 1 : 0,
      input.showOnOrganizationProfile ? 1 : 0,
      at,
      identity.id,
      identity.updated_at,
    );
}

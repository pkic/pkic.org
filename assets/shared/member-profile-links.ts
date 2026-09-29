import type { PublicMemberDetail } from "./schemas/members-directory";

type PublicIdentity = PublicMemberDetail["identities"][number];

/** Public profiles can remain cached across a deployment of the all-links projection. */
export function memberProfileLinks(identity: PublicIdentity | undefined): string[] {
  return identity?.links ?? (identity?.featuredLink ? [identity.featuredLink] : []);
}

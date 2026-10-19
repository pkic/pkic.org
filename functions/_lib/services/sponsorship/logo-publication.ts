import type { DatabaseLike } from "../../types";
import { publicNonMemberSponsorPredicate, publicOrganizationSponsorPredicate } from "../public-sponsors";
import { prepareSitePublicationRequest } from "../site-publication-requests";

/** Queue before mutation, so disappearance is captured inside the same atomic command. */
export function prepareSponsorshipLogoPublication(db: DatabaseLike, id: string, at: string, activating = false) {
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: "sponsorship",
      resourceId: id,
      revision: Date.parse(at),
      reasonCode: "sponsorship_changed",
      deduplicationKey: `sponsorship-state:${id}:${crypto.randomUUID()}`,
    },
    {
      sql: `EXISTS(SELECT 1 FROM sponsorships sponsorship LEFT JOIN organizations organization
    ON organization.id=sponsorship.organization_id WHERE sponsorship.id=? AND
    (? OR ${publicNonMemberSponsorPredicate("sponsorship")} OR
      (organization.id IS NOT NULL AND ${publicOrganizationSponsorPredicate("organization")})))`,
      bindings: [id, activating ? 1 : 0],
    },
  );
}

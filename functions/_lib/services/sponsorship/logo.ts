import { requirePermission } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import {
  removeStoredImagePointer,
  replaceStoredImagePointer,
  type StoredImagePointerDefinition,
  type StoredImagePointerRow,
} from "../stored-image-pointer";
import { publicNonMemberSponsorPredicate } from "../public-sponsors";
import { prepareSitePublicationRequest } from "../site-publication-requests";

function sponsorshipLogoPublication(db: DatabaseLike) {
  return (row: StoredImagePointerRow, nextKey: string | null, at: string) => {
    if (row.object_key === nextKey) return [];
    return [
      prepareSitePublicationRequest(
        db,
        {
          resourceType: "sponsorship",
          resourceId: row.id,
          revision: Date.parse(at),
          reasonCode: "sponsorship_changed",
          deduplicationKey: `sponsorship-logo:${row.id}:${crypto.randomUUID()}`,
        },
        {
          sql: `EXISTS(SELECT 1 FROM sponsorships sponsorship WHERE sponsorship.id=?
        AND sponsorship.organization_id IS NULL AND ${publicNonMemberSponsorPredicate("sponsorship")})`,
          bindings: [row.id],
        },
      ),
    ];
  };
}

const SPONSORSHIP_LOGO: StoredImagePointerDefinition = {
  table: "sponsorships",
  pointerColumn: "non_member_logo_r2_key",
  extraColumns: ["organization_id"],
  keyPrefix: "sponsor-logos",
  entityType: "sponsorship",
  notFoundCode: "SPONSORSHIP_NOT_FOUND",
  notFoundMessage: "Sponsorship not found",
};

function assertNonMemberSponsorship(row: StoredImagePointerRow): void {
  if (row.organization_id) {
    throw new AppError(
      422,
      "SPONSORSHIP_IS_ORG_LINKED",
      "This sponsorship is linked to a member organization; upload its logo through the organization.",
    );
  }
}

export async function replaceSponsorshipLogo(
  db: DatabaseLike,
  actor: AuthAdmin,
  bucket: R2Bucket,
  id: string,
  image: { buffer: ArrayBuffer; contentType: string },
) {
  requirePermission(actor, "sponsorships:write");
  return replaceStoredImagePointer({
    db,
    bucket,
    bucketName: "assets",
    definition: SPONSORSHIP_LOGO,
    id,
    image,
    validateRow: assertNonMemberSponsorship,
    prepareRelatedStatements: sponsorshipLogoPublication(db),
    audit: { actorType: "admin", actorId: actor.id, action: "sponsorship_logo_uploaded" },
  });
}

export async function removeSponsorshipLogo(db: DatabaseLike, actor: AuthAdmin, id: string) {
  requirePermission(actor, "sponsorships:write");
  return removeStoredImagePointer({
    db,
    bucketName: "assets",
    definition: SPONSORSHIP_LOGO,
    id,
    validateRow: assertNonMemberSponsorship,
    prepareRelatedStatements: sponsorshipLogoPublication(db),
    audit: { actorType: "admin", actorId: actor.id, action: "sponsorship_logo_removed" },
  });
}

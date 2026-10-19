import type { DatabaseLike, UserBackedAuthAdmin } from "../types";
import {
  getStoredImagePointer,
  removeStoredImagePointer,
  replaceStoredImagePointer,
  type StoredImagePointerDefinition,
  type StoredImagePointerRow,
} from "./stored-image-pointer";
import { prepareSitePublicationRequest } from "./site-publication-requests";
import { organizationBrandingPublicationCondition } from "./organization-content/branding-publication";
import { authorizedOrganizationMutationDb } from "./organization-management/authorization";

const ORGANIZATION_LOGO: StoredImagePointerDefinition = {
  table: "organizations",
  pointerColumn: "logo_r2_key",
  keyPrefix: "org-logos",
  entityType: "organization",
  notFoundCode: "NOT_FOUND",
  notFoundMessage: "Organization not found",
};

function organizationLogoPublication(db: DatabaseLike) {
  return (row: StoredImagePointerRow, nextKey: string | null, at: string) => {
    if (row.object_key === nextKey) return [];
    // Related statements run after the pointer CAS; compare the new row with its old key.
    const branding = organizationBrandingPublicationCondition(row.id, { logoR2Key: row.object_key });
    return [
      prepareSitePublicationRequest(
        db,
        {
          resourceType: "organization_content",
          resourceId: row.id,
          revision: Date.parse(at),
          reasonCode: "organization_content_changed",
          deduplicationKey: `organization-logo:${row.id}:${crypto.randomUUID()}`,
        },
        {
          sql: `EXISTS(SELECT 1 FROM members WHERE organization_id=? AND status='active') OR ${branding.sql}`,
          bindings: [row.id, ...branding.bindings],
        },
      ),
    ];
  };
}

export function getOrganizationLogoPointer(db: DatabaseLike, id: string) {
  return getStoredImagePointer(db, ORGANIZATION_LOGO, id);
}

export async function replaceOrganizationLogo(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  bucket: R2Bucket,
  id: string,
  image: { buffer: ArrayBuffer; contentType: string },
) {
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  return replaceStoredImagePointer({
    db: authorizedDb,
    prepareRelatedStatements: organizationLogoPublication(authorizedDb),
    bucket,
    bucketName: "assets",
    definition: ORGANIZATION_LOGO,
    id,
    image,
    audit: { actorType: "admin", actorId: actor.id, action: "organization_logo_uploaded" },
  });
}

export async function removeOrganizationLogo(db: DatabaseLike, actor: UserBackedAuthAdmin, id: string) {
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  return removeStoredImagePointer({
    db: authorizedDb,
    prepareRelatedStatements: organizationLogoPublication(authorizedDb),
    bucketName: "assets",
    definition: ORGANIZATION_LOGO,
    id,
    audit: { actorType: "admin", actorId: actor.id, action: "organization_logo_removed" },
  });
}

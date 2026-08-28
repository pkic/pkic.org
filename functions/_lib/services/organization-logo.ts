import type { DatabaseLike, UserBackedAuthAdmin } from "../types";
import {
  getStoredImagePointer,
  removeStoredImagePointer,
  replaceStoredImagePointer,
  type StoredImagePointerDefinition,
} from "./stored-image-pointer";
import { authorizedOrganizationMutationDb } from "./organization-management/authorization";

const ORGANIZATION_LOGO: StoredImagePointerDefinition = {
  table: "organizations",
  pointerColumn: "logo_r2_key",
  keyPrefix: "org-logos",
  entityType: "organization",
  notFoundCode: "NOT_FOUND",
  notFoundMessage: "Organization not found",
};

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
  return replaceStoredImagePointer({
    db: authorizedOrganizationMutationDb(db, actor, "organizations:write"),
    bucket,
    bucketName: "assets",
    definition: ORGANIZATION_LOGO,
    id,
    image,
    audit: { actorType: "admin", actorId: actor.id, action: "organization_logo_uploaded" },
  });
}

export async function removeOrganizationLogo(db: DatabaseLike, actor: UserBackedAuthAdmin, id: string) {
  return removeStoredImagePointer({
    db: authorizedOrganizationMutationDb(db, actor, "organizations:write"),
    bucketName: "assets",
    definition: ORGANIZATION_LOGO,
    id,
    audit: { actorType: "admin", actorId: actor.id, action: "organization_logo_removed" },
  });
}

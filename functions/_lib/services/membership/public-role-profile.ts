import { findLinkedinUrl, parseLinksJson } from "../../../../assets/shared/schemas/links";
import { sanitizeLegacyHttpUrl } from "../../../../assets/shared/schemas/urls";

export interface PublicRoleProfileRow {
  first_name: string | null;
  last_name: string | null;
  org_id: string | null;
  org_name: string | null;
  org_logo_r2_key: string | null;
  org_website: string | null;
  member_id: string | null;
  headshot_r2_key: string | null;
  links_json: string | null;
}

export interface PublicRoleProfile {
  name: string;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  organizationWebsite: string | null;
  photoUrl: string | null;
  linkedin: string | null;
}

/** Canonical public mapping for forum and working-group role holders. */
export function toPublicRoleProfile(row: PublicRoleProfileRow): PublicRoleProfile {
  return {
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    organizationName: row.org_name,
    organizationLogoUrl: row.org_logo_r2_key && row.org_id ? `/api/v1/members/${row.org_id}/logo` : null,
    organizationWebsite: sanitizeLegacyHttpUrl(row.org_website),
    photoUrl: row.headshot_r2_key && row.member_id ? `/api/v1/members/${row.member_id}/logo` : null,
    linkedin: findLinkedinUrl(parseLinksJson(row.links_json)),
  };
}

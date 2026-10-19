import { deleteJson } from "../../../../../shared/api-client";
import { replaceFile } from "../../../../../shared/file-upload";
import { logoUploadResponseSchema } from "../../../../../../shared/schemas/images";
import { successResponseSchema } from "../../../../../../shared/schemas/api-common";
import { toast } from "../../../ui";
import type { Sponsorship } from "../../../../../../shared/schemas/sponsorship-management";
import { PictureTile } from "../../../../../components/PictureTile";

/**
 * Logo tile for non-member sponsors only (organizationId null) — the same
 * `PictureTile` an organization's logo uses. Org-tied sponsors show/manage
 * their logo via the organization itself, since that's what the public
 * sponsor list actually reads (organizations.logo_r2_key,
 * GET /api/v1/members/:id/logo).
 */
export function SponsorshipLogo({ sponsorship, onChanged }: { sponsorship: Sponsorship; onChanged: () => void }) {
  const endpoint = `/api/v1/sponsors/${encodeURIComponent(sponsorship.id)}/logo`;
  const name = sponsorship.nonMemberName ?? "Sponsor";

  return (
    <PictureTile
      name={name}
      canChange
      imageUrl={sponsorship.nonMemberLogoUrl}
      alt={`${name} logo`}
      removeConfirmation="Remove this sponsor's logo?"
      accept="image/svg+xml"
      hint="SVG only. The logo is sanitized, cropped to its content, and made responsive automatically."
      onUpload={(file) => replaceFile(endpoint, file, logoUploadResponseSchema, "Could not upload the sponsor logo.")}
      onRemove={() => deleteJson(endpoint, successResponseSchema)}
      onChanged={onChanged}
      toast={toast}
    />
  );
}

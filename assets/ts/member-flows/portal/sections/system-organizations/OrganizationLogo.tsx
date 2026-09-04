/**
 * An organization's mark: the tile is the whole affordance. Read-only viewers
 * see the logo, or the name's initials while there is none; editors hover or
 * focus the tile to change it and find Remove beside it. There is no panel
 * header and no button standing open next to the picture.
 */
import { logoUploadResponseSchema } from "../../../../../shared/schemas/images";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { LogoTile } from "../../../../components/LogoTile";
import { deleteJson } from "../../../../shared/api-client";
import { replaceFile } from "../../../../shared/file-upload";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { toast } from "../../ui";

export function OrganizationLogo({
  organization,
  canWrite,
  onChanged,
  size,
}: {
  organization: OrganizationDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  /** `mark` for the record header, where the tile sits beside the name. */
  size?: "default" | "mark";
}) {
  return (
    <LogoTile
      size={size}
      name={organization.name}
      imageUrl={organization.logoUrl}
      alt={`${organization.name} logo`}
      canChange={canWrite}
      removeConfirmation="Remove this organization's logo?"
      removeLabel="Remove"
      accept="image/svg+xml"
      hint="SVG only. The logo is sanitized, cropped to its content, and made responsive automatically."
      onUpload={(file) =>
        replaceFile(
          `/api/v1/organizations/${encodeURIComponent(organization.id)}/logo`,
          file,
          logoUploadResponseSchema,
          "Could not upload the organization logo.",
        )
      }
      onRemove={() =>
        deleteJson(`/api/v1/organizations/${encodeURIComponent(organization.id)}/logo`, successResponseSchema)
      }
      onChanged={onChanged}
      toast={toast}
    />
  );
}

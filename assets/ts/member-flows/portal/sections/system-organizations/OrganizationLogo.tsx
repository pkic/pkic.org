import { logoUploadResponseSchema } from "../../../../../shared/schemas/images";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { LogoManager } from "../../../../components/LogoManager";
import { deleteJson } from "../../../../shared/api-client";
import { replaceFile } from "../../../../shared/file-upload";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { toast } from "../../ui";

export function OrganizationLogo({
  organization,
  canWrite,
  onChanged,
}: {
  organization: OrganizationDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  if (!canWrite) {
    return organization.logoUrl ? (
      <img
        class="img-fluid mb-2 border rounded p-2 bg-white"
        src={organization.logoUrl}
        alt={`${organization.name} logo`}
      />
    ) : null;
  }

  return (
    <LogoManager
      imageUrl={organization.logoUrl}
      alt={`${organization.name} logo`}
      layout="centered"
      imageClass="img-fluid mb-2 border rounded p-2 bg-white adm-organization-logo"
      placeholderClass="d-flex align-items-center justify-content-center mb-2 border rounded bg-light text-muted adm-organization-logo-placeholder"
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

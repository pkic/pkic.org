import { logoUploadResponseSchema } from "../../../../../shared/schemas/images";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { LogoManager } from "../../../../components/LogoManager";
import { deleteJson, putJson } from "../../../../shared/api-client";
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
      onUpload={(file) =>
        putJson(`/api/v1/organizations/${encodeURIComponent(organization.id)}/logo`, file, logoUploadResponseSchema, {
          "Content-Type": file.type || "application/octet-stream",
        })
      }
      onRemove={() =>
        deleteJson(`/api/v1/organizations/${encodeURIComponent(organization.id)}/logo`, successResponseSchema)
      }
      onChanged={onChanged}
      toast={toast}
    />
  );
}
